// POST /api/ai/:projectId/:entityId/agent/:agentId/chat — send a follow-up instruction to one Wave 1
// agent. Re-runs the agent with the instruction applied and appends both turns to its chat thread.
import { NextRequest } from 'next/server'
import { loadProject, saveProject } from '@/lib/server/helpers'
import { requireProjectAuth } from '@/lib/server/auth'
import { createSSEStream } from '@/lib/server/sse'
import { getWave1Agent, recomputeWave1Locks, resolveWave1Entity, runWave1Agent, WAVE1_AGENT_IDS } from '@/lib/server/wave1Engine'

export const runtime = 'nodejs'
export const maxDuration = 720

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; entityId: string; agentId: string }> }
) {
  const { projectId, entityId, agentId } = await params
  if (!await requireProjectAuth(request, projectId)) {
    return createSSEStream(async (send, close) => { send({ error: 'Not authenticated' }); close() })
  }
  if (!WAVE1_AGENT_IDS.includes(agentId)) {
    return createSSEStream(async (send, close) => { send({ error: 'Unknown agent' }); close() })
  }

  const body = await request.json()
  const message: string = (body?.message || '').trim()

  return createSSEStream(async (send, close) => {
    try {
      if (!message) { send({ error: 'Message is required' }); return close() }
      const project = await loadProject(projectId)
      if (!project) { send({ error: 'Project not found' }); return close() }
      const entity = resolveWave1Entity(project, entityId)
      if (!entity) { send({ error: 'Entity not found' }); return close() }

      recomputeWave1Locks(entity)
      const agent = getWave1Agent(entity, agentId)
      if (agent.status === 'locked') {
        send({ error: 'This agent is locked until its upstream dependencies are approved.' })
        return close()
      }
      if (agent.approvedVersion !== null) {
        send({ error: 'This agent has already been approved — its output is locked and can no longer be changed.' })
        return close()
      }

      agent.status = 'in_progress'
      await saveProject(project)

      let version: number | null, preview: string, final: boolean, newSources: Record<string, any>
      try {
        // Built from chatHistory as it stood BEFORE this turn, so the instruction isn't duplicated in the prompt.
        ({ version, preview, final, newSources } = await runWave1Agent(project, entity, agentId, message))
      } catch (runErr: any) {
        agent.status = agent.versionHistory?.length ? 'complete' : 'not_started'
        await saveProject(project)
        throw runErr
      }

      if (!agent.chatHistory) agent.chatHistory = []
      const now = new Date().toISOString()
      agent.chatHistory.push({ role: 'user', content: message, at: now })
      // Some assistants run their own internal multi-step gated workflow and reply with plain text (a gate
      // checkpoint, or a refusal when there's no document evidence) instead of the final JSON schema until
      // that resolves. Surface it as a normal chat turn — no version/approval yet — so the human can keep
      // the conversation going (confirm the gate, upload documents, etc.) rather than seeing a hard error.
      agent.chatHistory.push({
        role: 'agent', content: preview, v: final ? version : undefined, at: now,
        newSources: Object.keys(newSources || {}).length ? newSources : undefined,
      })
      if (!final) agent.status = agent.versionHistory?.length ? 'complete' : 'not_started'

      recomputeWave1Locks(entity)
      await saveProject(project)

      send({ done: true, entityId, agentId, version, preview, final })
      close()
    } catch (err: any) { send({ error: err.message }); close() }
  })
}
