import { NextRequest, NextResponse } from 'next/server'
import { loadProject, saveProject, parseJsonFromText } from '@/lib/server/helpers'
import { callSiaGPT } from '@/lib/server/siagpt'
import { requireProjectAuth } from '@/lib/server/auth'
import { config } from '@/lib/server/config'
import { buildSystemPrompt } from '@/lib/server/prompts'

export const runtime = 'nodejs'
export const maxDuration = 720

export async function POST(request: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  if (!await requireProjectAuth(request, projectId)) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  try {
    const project = await loadProject(projectId)
    if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const pillarSWOTs = Object.entries(project.assessment.pillars).map(([id, p]: [string, any]) => ({
      pillar: `${id}: ${p.name}`, score: p.finalScore, swot: p.swot
    }))
    const prompt = `${buildSystemPrompt(project)}

Consolidate these pillar SWOTs into an entity-level SWOT for ${project.entityName}. Synthesize and de-duplicate. Rank by significance.

PILLAR SWOTs:
${JSON.stringify(pillarSWOTs, null, 2)}

Return ONLY this JSON:
{
  "consolidatedSwot": {
    "strengths": [{"text":"","sourcePillar":"P1","significance":"high|medium|low"}],
    "weaknesses": [{"text":"","sourcePillar":"P2","significance":"high|medium|low"}],
    "opportunities": [{"text":"","sourcePillar":"P3","significance":"high|medium|low"}],
    "threats": [{"text":"","sourcePillar":"P7","significance":"high|medium|low"}]
  },
  "strategicHypothesis": "<400-500 word synthesis>"
}`
    const { text: rawText } = await callSiaGPT(prompt, {
      assistantId: config.assistantIds.swot,
      tools: [],
      context: 'consolidate SWOT',
    })
    const result = parseJsonFromText(rawText)
    project.assessment.consolidatedSwot = result.consolidatedSwot
    project.assessment.strategicHypothesis = { aiDraft: result.strategicHypothesis, edited: result.strategicHypothesis }
    await saveProject(project)
    return NextResponse.json({ success: true, data: result })
  } catch (err: any) { return NextResponse.json({ error: err.message }, { status: 500 }) }
}
