import { NextRequest } from 'next/server'
import { loadProject } from '@/lib/server/helpers'
import { callSiaGPT } from '@/lib/server/siagpt'
import { requireProjectAuth } from '@/lib/server/auth'
import { config } from '@/lib/server/config'
import { getAgentPersona } from '@/lib/server/prompts'
import { createSSEStream } from '@/lib/server/sse'

export const runtime = 'nodejs'
export const maxDuration = 300

export async function POST(request: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  if (!await requireProjectAuth(request, projectId)) {
    return createSSEStream(async (send, close) => { send({ error: 'Not authenticated' }); close() })
  }

  const body = await request.json()

  return createSSEStream(async (send, close) => {
    try {
      const project = await loadProject(projectId)
      if (!project) { send({ error: 'Project not found' }); return close() }

      const { messages, context } = body
      const pillarId = context?.pillarId

      const allPillarsSnapshot = Object.entries(project.assessment.pillars || {})
        .map(([pid, p]: [string, any]) => {
          const isCurrent = pid === pillarId
          const elements = (p.elements || [])
            .map((e: any) => `    • ${e.name} (score: ${e.aiScore ?? '?'}): ${(e.aiAnswer || '').substring(0, 150)}`)
            .join('\n')
          const swot = p.swot
            ? `    Strengths: ${(p.swot.strengths || []).join('; ') || 'none'}\n    Weaknesses: ${(p.swot.weaknesses || []).join('; ') || 'none'}\n    Opportunities: ${(p.swot.opportunities || []).join('; ') || 'none'}\n    Threats: ${(p.swot.threats || []).join('; ') || 'none'}`
            : '    SWOT: not yet assessed'
          return `${isCurrent ? '► ' : '  '}${pid}: ${p.name}  |  Score: ${p.finalScore ?? p.aiScore ?? 'not scored'}  |  Status: ${p.status || 'unknown'}${isCurrent ? '  ← CURRENT FOCUS' : ''}
  Summary: ${(p.execSummary?.edited || 'Not yet assessed').substring(0, 300)}
  Elements:\n${elements || '    (no elements scored yet)'}
  SWOT:\n${swot}`
        }).join('\n\n')

      const docContext = (project.documents || [])
        .map((d: any) => `=== ${d.name} ===\n${(d.extractedText || '').substring(0, 2000)}`)
        .join('\n\n').substring(0, 8000) || 'No documents uploaded.'

      const persona = getAgentPersona(pillarId || '')
      const systemPrompt = `${persona}
You are assisting with the strategic assessment of ${project.entityName} (${project.entityType}).
Sector: ${project.sector || 'Not specified'}. Assessment period: ${project.assessmentDateStart || ''} – ${project.assessmentDateEnd || ''}.

━━━ FULL ASSESSMENT OVERVIEW — ALL PILLARS ━━━
${allPillarsSnapshot}

━━━ UPLOADED DOCUMENTS CONTEXT ━━━
${docContext}

INSTRUCTIONS:
- You have visibility of the ENTIRE assessment across all pillars — use this for cross-pillar insights
- Be specific, analytical, and evidence-based; reference actual content from documents when relevant
- Format responses using markdown: use **bold** for key terms, bullet lists for findings, ## headers for sections
- Challenge assumptions and provide rigorous, consulting-grade analysis
- When asked about a score, explain exactly what evidence or actions would justify improvement
- When asked cross-pillar questions (e.g. overall maturity, strategic coherence), draw on all pillar data
- Never be vague — be direct and substantive`

      const fullMessages = messages || [{ role: 'user', content: body.message || '' }]
      const lastUserMsg = fullMessages.filter((m: any) => m.role === 'user').pop()?.content || ''
      const conversationContext = fullMessages.slice(0, -1)
        .map((m: any) => `${m.role === 'assistant' ? 'Assistant' : 'User'}: ${m.content}`)
        .join('\n')
      const fullPrompt = systemPrompt + (conversationContext ? `\n\nConversation so far:\n${conversationContext}` : '') + `\n\nUser question: ${lastUserMsg}`

      const { text: aiText } = await callSiaGPT(fullPrompt, {
        assistantId: config.assistantIds.chat,
        collectionIds: project.siagptCollectionId ? [project.siagptCollectionId] : [],
        tools: ['rag', 'document_content', 'list_documents'],
        context: `chat — ${pillarId ? `pillar ${pillarId}` : 'general'}`,
      })

      const chunks = aiText.match(/[\s\S]{1,80}/g) || [aiText]
      for (const chunk of chunks) {
        send({ chunk })
        await new Promise(r => setTimeout(r, 15))
      }
      send({ done: true })
      close()
    } catch (err: any) { send({ error: err.message }); close() }
  })
}
