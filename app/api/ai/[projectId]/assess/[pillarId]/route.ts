import { NextRequest } from 'next/server'
import { loadProject, saveProject, parseJsonFromText } from '@/lib/server/helpers'
import { callSiaGPT } from '@/lib/server/siagpt'
import { requireProjectAuth } from '@/lib/server/auth'
import { config } from '@/lib/server/config'
import { buildAssessmentPrompt } from '@/lib/server/prompts'
import { createSSEStream } from '@/lib/server/sse'

export const runtime = 'nodejs'
export const maxDuration = 720 // 12 minutes

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; pillarId: string }> }
) {
  const { projectId, pillarId } = await params
  if (!await requireProjectAuth(request, projectId)) {
    return createSSEStream(async (send, close) => {
      send({ error: 'Not authenticated' }); close()
    })
  }

  return createSSEStream(async (send, close) => {
    try {
      const project = await loadProject(projectId)
      if (!project) { send({ error: 'Project not found' }); return close() }

      const collIds = project.siagptCollectionId ? [project.siagptCollectionId] : []
      const prompt = buildAssessmentPrompt(project, pillarId)
      const siaResult = await callSiaGPT(prompt, {
        assistantId: config.pillarAssistantIds[pillarId],
        collectionIds: collIds,
        context: `pillar ${pillarId} assessment — ${project.assessment.pillars[pillarId]?.name}`,
      })

      // Stream text chunks
      const chunks = siaResult.text.match(/[\s\S]{1,50}/g) || [siaResult.text]
      for (const chunk of chunks) {
        send({ chunk })
        await new Promise(r => setTimeout(r, 20))
      }

      const parsed = parseJsonFromText(siaResult.text)
      const result = parsed.pillarAssessment ?? parsed

      const p = project.assessment.pillars[pillarId]
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
          id: existing?.id || `${pillarId}_E${i + 1}`,
          name: elName,
          aiAnswer: el.aiAnswer || '',
          evidenceQuote: el.evidenceQuote || '',
          sourceDocument: el.sourceDocument || '',
          aiScore: el.score ?? null,
          manualScore: existing?.manualScore ?? null,
          scoreRationale: el.scoreRationale || '',
          notes: existing?.notes ?? '',
          dataGap: el.dataGap ?? null,
        }
      })

      p.swot = result.swot || { strengths: [], weaknesses: [], opportunities: [], threats: [] }
      const iq = result.interviewQuestions || {}
      p.interviewQuestions = {
        leadership: iq.leadership || [],
        team: iq.team || [],
        gapFilling: iq.gapFilling || [],
      }
      p.missingInfo = result.missingInfo || []
      p.references = result.references || []
      p.newSources = siaResult.newSources
      p.status = 'complete'
      await saveProject(project)

      send({ done: true, pillarId, score: result.pillarScore })
      close()
    } catch (err: any) {
      send({ error: err.message }); close()
    }
  })
}
