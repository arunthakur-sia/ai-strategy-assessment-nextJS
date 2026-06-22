import { NextRequest } from 'next/server'
import { loadProject, saveProject, parseJsonFromText, applyEntityPillarResult } from '@/lib/server/helpers'
import { callSiaGPT } from '@/lib/server/siagpt'
import { requireProjectAuth } from '@/lib/server/auth'
import { config } from '@/lib/server/config'
import { buildAssessmentPrompt } from '@/lib/server/prompts'
import { createSSEStream } from '@/lib/server/sse'
import { log } from '@/lib/server/logger'

export const runtime = 'nodejs'
export const maxDuration = 800

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params
  if (!await requireProjectAuth(request, projectId)) {
    return createSSEStream(async (send, close) => { send({ error: 'Not authenticated' }); close() })
  }

  const body = await request.json()

  return createSSEStream(async (send, close) => {
    try {
      const project = await loadProject(projectId)
      if (!project) { send({ error: 'Project not found' }); return close() }

      const { entityIds }: { entityIds?: string[] } = body
      const allEntities: any[] = project.entities || []
      const targetEntities = entityIds?.length
        ? allEntities.filter((e: any) => entityIds.includes(e.id))
        : allEntities

      if (targetEntities.length === 0) { send({ error: 'No entities found' }); return close() }

      const pillarIds = ['P1','P2','P3','P4','P5','P6','P7','P8']
      const allResults: Record<string, Record<string, any>> = {}
      log.info(`[assess-entities] ${targetEntities.length} entities × 8 pillars = ${targetEntities.length * 8} parallel calls`)

      await Promise.allSettled(
        targetEntities.flatMap((entity: any) =>
          pillarIds.map(async (pillarId: string) => {
            if (!entity.assessment?.pillars?.[pillarId]) return
            try {
              const entityProject = { entityName: entity.name, entityType: entity.type, assessment: entity.assessment, rubric: project.rubric }
              const collIds = entity.siagptCollectionId ? [entity.siagptCollectionId] : []
              const prompt = buildAssessmentPrompt(entityProject, pillarId)
              const { text: rawText } = await callSiaGPT(prompt, {
                assistantId: config.pillarAssistantIds[pillarId],
                collectionIds: collIds,
                context: `multi-entity: ${entity.name} P${pillarId.slice(1)}`,
              })
              const parsed = parseJsonFromText(rawText)
              const result = parsed.pillarAssessment ?? parsed
              if (!allResults[entity.id]) allResults[entity.id] = {}
              allResults[entity.id][pillarId] = result
              send({ entityId: entity.id, entityName: entity.name, pillarId, progress: true, score: result.pillarScore })
            } catch (err: any) {
              send({ entityId: entity.id, entityName: entity.name, pillarId, error: err.message })
            }
          })
        )
      )

      if (Object.keys(allResults).length > 0) {
        const fresh = await loadProject(projectId)
        if (fresh) {
          for (const [entityId, pillarResults] of Object.entries(allResults)) {
            const freshEntity = (fresh.entities || []).find((e: any) => e.id === entityId)
            if (!freshEntity) continue
            for (const [pid, result] of Object.entries(pillarResults)) applyEntityPillarResult(freshEntity, pid, result)
          }
          await saveProject(fresh)
        }
      }

      send({ done: true, entityCount: targetEntities.length, completedCount: Object.keys(allResults).length })
      close()
    } catch (err: any) { send({ error: err.message }); close() }
  })
}
