// POST /api/ai/:projectId/:entityId/agent/:agentId/chat — send a follow-up instruction to one Wave 1 or
// Wave 2 agent. Re-runs the agent with the instruction applied and appends both turns to its chat thread.
import { NextRequest, after } from 'next/server'
import { loadProject, saveProject } from '@/lib/server/helpers'
import { requireProjectAuth } from '@/lib/server/auth'
import { createSSEStream } from '@/lib/server/sse'
import { resolveWave1Entity } from '@/lib/server/wave1Engine'
import { ALL_AGENT_IDS, getAnyAgent, recomputeAllLocks, runAgent } from '@/lib/server/wave2Engine'

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
  if (!ALL_AGENT_IDS.includes(agentId)) {
    return createSSEStream(async (send, close) => { send({ error: 'Unknown agent' }); close() })
  }

  const body = await request.json()
  const message: string = (body?.message || '').trim()

  // The agent run is deliberately NOT tied to the HTTP response. It is registered with after() so the
  // platform keeps the function alive until it finishes, and it persists its own result (chat turns,
  // version, status) — so closing the tab / losing the connection never cancels or loses the answer.
  // The SSE stream below is only a convenience that relays the outcome if the client is still there.
  type Outcome = { error: string } | { done: true; entityId: string; agentId: string; version: number | null; preview: string; final: boolean }
  const work: Promise<Outcome> = runAndPersist(projectId, entityId, agentId, message)
  after(() => work)

  return createSSEStream(async (send, close) => {
    const outcome = await work
    send(outcome)
    close()
  })
}

async function runAndPersist(projectId: string, entityId: string, agentId: string, message: string) {
  try {
    if (!message) return { error: 'Message is required' }
    const project = await loadProject(projectId)
    if (!project) return { error: 'Project not found' }
    const entity = resolveWave1Entity(project, entityId)
    if (!entity) return { error: 'Entity not found' }

    recomputeAllLocks(entity)
    const agent = getAnyAgent(entity, agentId)
    if (agent.status === 'locked') {
      return { error: 'This agent is locked until its upstream dependencies are approved.' }
    }
    if (agent.approvedVersion !== null) {
      return { error: 'This agent has already been approved — its output is locked and can no longer be changed.' }
    }

    // Persisted up front so a reloaded/reopened UI can still show the in-flight instruction and a spinner.
    agent.status = 'in_progress'
    agent.pendingMessage = { content: message, at: new Date().toISOString() }
    await saveProject(project)

    let version: number | null, preview: string, final: boolean, newSources: Record<string, any>
    try {
      // Built from chatHistory as it stood BEFORE this turn, so the instruction isn't duplicated in the prompt.
      ({ version, preview, final, newSources } = await runAgent(project, entity, agentId, message))
    } catch (runErr: any) {
      // Record the failure as a chat turn so it's visible even if the user was away when it happened.
      if (!agent.chatHistory) agent.chatHistory = []
      const at = new Date().toISOString()
      agent.chatHistory.push({ role: 'user', content: message, at })
      agent.chatHistory.push({ role: 'agent', content: `⚠ This run failed: ${runErr?.message || 'Unknown error'}. You can send the instruction again.`, at })
      agent.pendingMessage = null
      agent.status = agent.versionHistory?.length ? 'complete' : 'not_started'
      await saveProject(project)
      return { error: runErr?.message || 'Unknown error' }
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
    agent.pendingMessage = null
    if (!final) agent.status = agent.versionHistory?.length ? 'complete' : 'not_started'

    recomputeAllLocks(entity)
    await saveProject(project)

    return { done: true as const, entityId, agentId, version, preview, final }
  } catch (err: any) {
    return { error: err?.message || 'Unknown error' }
  }
}
