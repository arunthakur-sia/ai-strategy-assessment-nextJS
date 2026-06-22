import { NextRequest, NextResponse } from 'next/server'
import { loadProject, parseJsonFromText } from '@/lib/server/helpers'
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

    const { task, context } = await request.json()
    const entityId = context?.entityId
    const targetEntity = entityId ? (project.entities || []).find((e: any) => e.id === entityId) : null
    const assessmentData = targetEntity ? targetEntity.assessment : project.assessment
    const entityName = targetEntity ? targetEntity.name : project.entityName
    const entityType = targetEntity ? targetEntity.type : project.entityType
    const strategyData = targetEntity ? (targetEntity.strategy || project.strategy) : project.strategy

    const pillarSummaries = Object.entries(assessmentData.pillars)
      .map(([, p]: [string, any]) => `${p.name}: Score ${p.finalScore || 'N/A'} - ${p.execSummary?.edited?.substring(0, 150) || 'Not assessed'}`)
      .join('\n')

    const taskMap: Record<string, [string, string]> = {
      vision_mission: [`Generate Vision and Mission for ${entityName}.`, `{"vision":"<20-30 words>","mission":"<40-60 words>","rationale":"<explanation>"}`],
      strategic_objectives: [`Generate ${context?.count || 4} strategic objectives for ${entityName}.`, `{"objectives":[{"title":"","description":"","linkedPillars":["P1"],"rationale":"","priority":"high|medium"}]}`],
      kpis: [`Generate 4-6 KPIs for objective: "${context?.objectiveTitle}" for ${entityName}.`, `{"kpis":[{"indicator":"","baseline":"","target":"","targetYear":2030,"unit":"","owner":""}]}`],
      initiatives: [`Generate 3-5 initiatives for objective: "${context?.objectiveTitle}".`, `{"initiatives":[{"title":"","description":"","owner":"","startYear":2025,"endYear":2027,"priority":"high|medium|low"}]}`],
      projects: [`Generate 3-6 projects for initiative: "${context?.initiativeTitle}".`, `{"projects":[{"name":"","description":"","deliveryYear":2025,"owner":"","source":"Internal"}]}`],
      consistency_check: [`Review strategy for ${entityName}: ${JSON.stringify(strategyData)}`, `{"issues":[{"type":"gap|inconsistency","description":"","recommendation":""}],"overallAssessment":""}`]
    }
    const [taskPrompt, schema] = taskMap[task] || ['', '{}']
    const systemCtx = targetEntity
      ? `You are an expert strategy consultant at SIA Partners. Assess ${entityName} (${entityType}) using the 8-pillar framework.`
      : buildSystemPrompt(project)
    const prompt = `${systemCtx}\n\n${taskPrompt}\n\nContext:\n${pillarSummaries}\n\nReturn ONLY: ${schema}`
    const { text: rawText } = await callSiaGPT(prompt, {
      assistantId: config.assistantIds.strategy,
      tools: [],
      context: `strategy generate — ${task}`,
    })
    const data = parseJsonFromText(rawText)
    return NextResponse.json({ success: true, data })
  } catch (err: any) { return NextResponse.json({ error: err.message }, { status: 500 }) }
}
