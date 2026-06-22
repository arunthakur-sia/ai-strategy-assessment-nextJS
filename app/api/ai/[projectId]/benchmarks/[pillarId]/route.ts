import { NextRequest, NextResponse } from 'next/server'
import { loadProject, saveProject, parseJsonFromText } from '@/lib/server/helpers'
import { callSiaGPT } from '@/lib/server/siagpt'
import { requireProjectAuth } from '@/lib/server/auth'
import { config } from '@/lib/server/config'
import { buildSystemPrompt } from '@/lib/server/prompts'

export const runtime = 'nodejs'
export const maxDuration = 300

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; pillarId: string }> }
) {
  const { projectId, pillarId } = await params
  if (!await requireProjectAuth(request, projectId)) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  try {
    const project = await loadProject(projectId)
    if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const body = await request.json().catch(() => ({}))
    const entityId = body?.entityId as string | undefined

    let targetPillars: any, entityName: string, entityType: string
    if (entityId) {
      const entity = (project.entities || []).find((e: any) => e.id === entityId)
      if (!entity) return NextResponse.json({ error: 'Entity not found' }, { status: 404 })
      targetPillars = entity.assessment.pillars
      entityName = entity.name
      entityType = entity.type || project.entityType
    } else {
      targetPillars = project.assessment.pillars
      entityName = project.entityName
      entityType = project.entityType
    }

    const pillar = targetPillars[pillarId]
    if (!pillar) return NextResponse.json({ error: 'Pillar not found' }, { status: 404 })

    const prompt = `${buildSystemPrompt({ entityName, entityType })}

Generate 6-8 real-world benchmark comparators for ${entityName} on ${pillar.name} (score: ${pillar.finalScore || 'N/A'}/5).
Include GCC government/corporate entities, regional peers, and global best practice examples.

Return ONLY valid JSON:
{
  "entityScore": ${pillar.finalScore || 3.0},
  "pillarName": "${pillar.name}",
  "benchmarks": [{"organization":"<name>","country":"<country>","flag":"<emoji>","score":<1.0-5.0>,"notes":"<insight>"}],
  "keyInsights": ["<2-3 insights on how entity compares>"],
  "improvementPriorities": ["<top 3 specific actions to close benchmark gap>"]
}`
    const { text: rawText } = await callSiaGPT(prompt, {
      assistantId: config.pillarAssistantIds[pillarId],
      tools: [],
      context: `benchmarks — pillar ${pillarId}`,
    })
    const benchmarkData = parseJsonFromText(rawText)
    targetPillars[pillarId].benchmarkData = benchmarkData
    await saveProject(project)
    return NextResponse.json({ success: true, data: benchmarkData })
  } catch (err: any) { return NextResponse.json({ error: err.message }, { status: 500 }) }
}
