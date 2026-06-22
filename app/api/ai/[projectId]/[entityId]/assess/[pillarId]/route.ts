import { NextRequest } from 'next/server'
import { loadProject, saveProject, parseJsonFromText, applyEntityPillarResult } from '@/lib/server/helpers'
import { callSiaGPT } from '@/lib/server/siagpt'
import { requireProjectAuth } from '@/lib/server/auth'
import { config } from '@/lib/server/config'
import { buildAssessmentPrompt } from '@/lib/server/prompts'
import { createSSEStream } from '@/lib/server/sse'

export const runtime = 'nodejs'
export const maxDuration = 720

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; entityId: string; pillarId: string }> }
) {
  const { projectId, entityId, pillarId } = await params
  if (!await requireProjectAuth(request, projectId)) {
    return createSSEStream(async (send, close) => { send({ error: 'Not authenticated' }); close() })
  }

  return createSSEStream(async (send, close) => {
    try {
      const project = await loadProject(projectId)
      if (!project) { send({ error: 'Project not found' }); return close() }
      const entity = (project.entities || []).find((e: any) => e.id === entityId)
      if (!entity) { send({ error: 'Entity not found' }); return close() }
      if (!entity.assessment.pillars[pillarId]) { send({ error: 'Pillar not found' }); return close() }

      const entityProject = { entityName: entity.name, entityType: entity.type, assessment: entity.assessment, rubric: project.rubric }
      const collIds = entity.siagptCollectionId ? [entity.siagptCollectionId] : []
      const prompt = buildAssessmentPrompt(entityProject, pillarId)
      const { text: rawText, newSources } = await callSiaGPT(prompt, {
        assistantId: config.pillarAssistantIds[pillarId],
        collectionIds: collIds,
        context: `entity ${entity.name} pillar ${pillarId} assessment`,
      })

      const chunks = rawText.match(/[\s\S]{1,50}/g) || [rawText]
      for (const chunk of chunks) { send({ chunk }); await new Promise(r => setTimeout(r, 20)) }

      const parsed = parseJsonFromText(rawText)
      const result = parsed.pillarAssessment ?? parsed
      applyEntityPillarResult(entity, pillarId, result)
      entity.assessment.pillars[pillarId].newSources = newSources
      await saveProject(project)

      send({ done: true, entityId: entity.id, pillarId, score: result.pillarScore })
      close()
    } catch (err: any) { send({ error: err.message }); close() }
  })
}
