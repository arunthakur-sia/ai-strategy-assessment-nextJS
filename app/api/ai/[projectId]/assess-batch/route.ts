import { NextRequest } from 'next/server'
import { loadProject, saveProject, parseJsonFromText } from '@/lib/server/helpers'
import { callSiaGPT } from '@/lib/server/siagpt'
import { requireProjectAuth } from '@/lib/server/auth'
import { config } from '@/lib/server/config'
import { buildAssessmentPrompt } from '@/lib/server/prompts'
import { createSSEStream } from '@/lib/server/sse'
import { log } from '@/lib/server/logger'

export const runtime = 'nodejs'
export const maxDuration = 300

const MAX_RETRIES = 2

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

      const { pillarIds } = body
      const validIds: string[] = (Array.isArray(pillarIds) ? pillarIds : [])
        .filter((id: string) => typeof id === 'string' && project.assessment.pillars[id])

      if (validIds.length === 0) { send({ error: 'No valid pillar IDs specified' }); return close() }

      const collIds = project.siagptCollectionId ? [project.siagptCollectionId] : []
      const results: Record<string, any> = {}
      const errors: Record<string, string> = {}

      log.info(`[batch-assess] Firing ${validIds.length} parallel SiaGPT calls: ${validIds.join(', ')}`)

      await Promise.allSettled(
        validIds.map(async (pillarId: string) => {
          let lastError: Error | undefined
          for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
            try {
              if (attempt > 0) {
                log.info(`[batch-assess] RETRY ${attempt}/${MAX_RETRIES} for pillar ${pillarId}`)
                send({ pillarId, retrying: true, attempt })
              }
              const prompt = buildAssessmentPrompt(project, pillarId)
              const { text: rawText, newSources } = await callSiaGPT(prompt, {
                assistantId: config.pillarAssistantIds[pillarId],
                collectionIds: collIds,
                context: `pillar ${pillarId} batch (attempt ${attempt + 1})`,
              })
              const parsed = parseJsonFromText(rawText)
              results[pillarId] = { ...(parsed.pillarAssessment ?? parsed), _newSources: newSources }
              send({ pillarId, progress: true, score: results[pillarId].pillarScore })
              return
            } catch (err: any) {
              lastError = err
              log.info(`[batch-assess] ERROR pillar ${pillarId} (attempt ${attempt + 1}) — ${err.message}`)
            }
          }
          errors[pillarId] = lastError!.message
          send({ pillarId, error: lastError!.message })
        })
      )

      if (Object.keys(results).length > 0) {
        const fresh = await loadProject(projectId)
        if (fresh) {
          for (const [pillarId, result] of Object.entries(results)) {
            const p = fresh.assessment.pillars[pillarId]
            if (!p) continue
            p.aiScore = result.pillarScore
            p.finalScore = result.pillarScore
            const summary = result.executiveSummary ?? ''
            p.execSummary.aiDraft = summary
            p.execSummary.edited = summary
            const existingElements: any[] = p.elements || []
            p.elements = (result.elements || []).map((el: any, i: number) => {
              const elName = el.name || ''
              const existing = existingElements.find(
                (e: any) => e.name?.toLowerCase().trim() === elName.toLowerCase().trim()
              ) || existingElements[i]
              return {
                id: existing?.id || `${pillarId}_E${i + 1}`, name: elName,
                aiAnswer: el.aiAnswer || '', evidenceQuote: el.evidenceQuote || '',
                sourceDocument: el.sourceDocument || '', aiScore: el.score ?? null,
                manualScore: existing?.manualScore ?? null, scoreRationale: el.scoreRationale || '',
                notes: existing?.notes ?? '', dataGap: el.dataGap ?? null,
              }
            })
            p.swot = result.swot || { strengths: [], weaknesses: [], opportunities: [], threats: [] }
            const iq = result.interviewQuestions || {}
            p.interviewQuestions = { leadership: iq.leadership || [], team: iq.team || [], gapFilling: iq.gapFilling || [] }
            p.missingInfo = result.missingInfo || []
            p.references = result.references || []
            p.newSources = result._newSources || {}
            p.status = 'complete'
          }
          await saveProject(fresh)
        }
      }

      send({ done: true, failedPillarIds: Object.keys(errors) })
      close()
    } catch (err: any) { send({ error: err.message }); close() }
  })
}
