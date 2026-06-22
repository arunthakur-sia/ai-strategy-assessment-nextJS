import { NextRequest } from 'next/server'
import { loadProject, saveProject, parseJsonFromText, applyEntityPillarResult } from '@/lib/server/helpers'
import { callSiaGPT } from '@/lib/server/siagpt'
import { requireProjectAuth } from '@/lib/server/auth'
import { config } from '@/lib/server/config'
import { buildAssessmentPrompt } from '@/lib/server/prompts'
import { createSSEStream } from '@/lib/server/sse'
import { log } from '@/lib/server/logger'

export const runtime = 'nodejs'
export const maxDuration = 720

const MAX_RETRIES = 2

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; entityId: string }> }
) {
  const { projectId, entityId } = await params
  if (!await requireProjectAuth(request, projectId)) {
    return createSSEStream(async (send, close) => { send({ error: 'Not authenticated' }); close() })
  }

  const body = await request.json()

  return createSSEStream(async (send, close) => {
    try {
      const project = await loadProject(projectId)
      if (!project) { send({ error: 'Project not found' }); return close() }
      const entity = (project.entities || []).find((e: any) => e.id === entityId)
      if (!entity) { send({ error: 'Entity not found' }); return close() }

      const reqPillarIds = body?.pillarIds
      const validIds: string[] = (Array.isArray(reqPillarIds) ? reqPillarIds : Object.keys(entity.assessment.pillars))
        .filter((id: string) => typeof id === 'string' && entity.assessment.pillars[id])

      if (validIds.length === 0) { send({ error: 'No valid pillar IDs' }); return close() }

      const entityProject = { entityName: entity.name, entityType: entity.type, assessment: entity.assessment, rubric: project.rubric }
      const collIds = entity.siagptCollectionId ? [entity.siagptCollectionId] : []
      const results: Record<string, any> = {}
      const errors: Record<string, string> = {}

      log.info(`[entity-batch-assess] ${entity.name}: ${validIds.length} pillars in parallel`)

      await Promise.allSettled(
        validIds.map(async (pillarId: string) => {
          let lastError: Error | undefined
          for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
            try {
              if (attempt > 0) {
                log.info(`[entity-batch-assess] RETRY ${attempt}/${MAX_RETRIES} for ${entity.name} pillar ${pillarId}`)
                send({ entityId: entity.id, pillarId, retrying: true, attempt })
              }
              const prompt = buildAssessmentPrompt(entityProject, pillarId)
              const { text: rawText, newSources } = await callSiaGPT(prompt, {
                assistantId: config.pillarAssistantIds[pillarId],
                collectionIds: collIds,
                context: `entity ${entity.name} pillar ${pillarId} batch (attempt ${attempt + 1})`,
              })
              const parsed = parseJsonFromText(rawText)
              results[pillarId] = { ...(parsed.pillarAssessment ?? parsed), _newSources: newSources }
              send({ entityId: entity.id, pillarId, progress: true, score: results[pillarId].pillarScore })
              return
            } catch (err: any) {
              lastError = err
              log.info(`[entity-batch-assess] ERROR ${entity.name} pillar ${pillarId} (attempt ${attempt + 1}) — ${err.message}`)
            }
          }
          errors[pillarId] = lastError!.message
          send({ entityId: entity.id, pillarId, error: lastError!.message })
        })
      )

      if (Object.keys(results).length > 0) {
        const fresh = await loadProject(projectId)
        if (fresh) {
          const freshEntity = (fresh.entities || []).find((e: any) => e.id === entityId)
          if (freshEntity) {
            for (const [pid, result] of Object.entries(results)) {
              applyEntityPillarResult(freshEntity, pid, result)
              freshEntity.assessment.pillars[pid].newSources = result._newSources || {}
            }
            await saveProject(fresh)
          }
        }
      }

      send({ done: true, entityId: entity.id, failedPillarIds: Object.keys(errors) })
      close()
    } catch (err: any) { send({ error: err.message }); close() }
  })
}
