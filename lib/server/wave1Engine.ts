import 'server-only'
import { callSiaGPT } from './siagpt'
import { config } from './config'
import {
  parseJsonWithNarrative, applyEntityPillarResult, applyPillarLikeResult, computePillarFinalScore,
  PILLAR_IDS, FANOUT_AGENT_IDS, FANOUT_NAMES,
} from './helpers'
import {
  buildAssessmentPrompt, buildIdiGuidePrompt, buildIdiSynthPrompt,
  buildEntitySwotPrompt,
} from './prompts'

export const WAVE1_AGENT_IDS = [...PILLAR_IDS, 'idiGuide', 'idiSynth', ...FANOUT_AGENT_IDS, 'swot']

type AgentKind = 'pillar' | 'narrative' | 'fanout' | 'swot'

function agentKind(agentId: string): AgentKind {
  if ((PILLAR_IDS as string[]).includes(agentId)) return 'pillar'
  if (agentId === 'idiGuide' || agentId === 'idiSynth') return 'narrative'
  if ((FANOUT_AGENT_IDS as string[]).includes(agentId)) return 'fanout'
  if (agentId === 'swot') return 'swot'
  throw new Error(`Unknown Wave 1 agent id: ${agentId}`)
}

/** Returns the live, mutable agent object — reflects the current draft, not necessarily the approved one. */
export function getWave1Agent(entity: any, agentId: string): any {
  const kind = agentKind(agentId)
  if (kind === 'pillar') return entity.assessment.pillars[agentId]
  if (kind === 'swot') return entity.assessment.swotAgent
  return entity.assessment.externalAgents[agentId]
}

/**
 * A project's "primary entity" (project.entityName/entityType/assessment/documents/siagptCollectionId) is
 * structurally the same shape as a subsidiary but lives on the project itself, not in project.entities[].
 * The sentinel id 'main' resolves to an adapter over those top-level fields so every Wave 1 route can treat
 * it exactly like any other entity — reads and writes on the adapter go straight through to the project.
 */
export function resolveWave1Entity(project: any, entityId: string): any {
  if (entityId !== 'main') return (project.entities || []).find((e: any) => e.id === entityId)
  return {
    id: 'main',
    name: project.entityName,
    type: project.entityType,
    assessment: project.assessment,
    documents: project.documents,
    get siagptCollectionId() { return project.siagptCollectionId },
    set siagptCollectionId(v: string) { project.siagptCollectionId = v },
    get interviewCollectionId() { return project.interviewCollectionId },
    set interviewCollectionId(v: string) { project.interviewCollectionId = v },
  }
}

function isApproved(entity: any, agentId: string): boolean {
  return getWave1Agent(entity, agentId).approvedVersion !== null
}

/**
 * Sets the reviewer's manual override score for a pillar (P1-P8 only — the fan-out agents share the same
 * Pillar shape but aren't in scope for manual scoring). Unlike aiScore, this isn't gated by approval or
 * chat state — a reviewer can set or clear it at any time, and finalScore (the single field every other
 * surface in the app reads) immediately reflects it, blended with aiScore per computePillarFinalScore.
 */
export function setWave1ManualScore(entity: any, agentId: string, manualScore: number | null) {
  if (!(PILLAR_IDS as string[]).includes(agentId)) throw new Error('Manual scoring only applies to pillar agents (P1-P8).')
  const agent = getWave1Agent(entity, agentId)
  agent.manualScore = manualScore
  agent.finalScore = computePillarFinalScore(agent.aiScore, manualScore)
}

/** Undecided (null) behaves like true — see the client-side mirror in lib/wave1Client.ts. */
function idiPathEnabled(entity: any): boolean {
  return entity.assessment.idiDocumentsAvailable !== false
}

/**
 * Records the reviewer's answer to "do you have documents to seed an IDI interview guide from?" and
 * re-wires bench's (the fan-out chain's entry point) dependency accordingly: true (or leaving it
 * unanswered) gates it on the approved IDI synthesis, exactly as before; false drops that dependency so
 * bench runs straight off the entity's own document collection, and idiGuide/idiSynth are skipped
 * entirely. pestel/marketSizing/competitor are unaffected — they always run in sequence after bench,
 * each locked until the previous fan-out agent is approved (mirrors the pillar chain). Blocked once
 * anything downstream of this choice has actually started, since switching after the fact would leave a
 * run built on the other path's assumptions.
 */
export function setIdiDocumentsAvailable(entity: any, value: boolean) {
  if (value === idiPathEnabled(entity)) { entity.assessment.idiDocumentsAvailable = value; return }
  const idiGuide = entity.assessment.externalAgents.idiGuide
  const idiSynth = entity.assessment.externalAgents.idiSynth
  const started = idiGuide.chatHistory?.length || idiSynth.chatHistory?.length
    || FANOUT_AGENT_IDS.some(id => entity.assessment.externalAgents[id].chatHistory?.length)
  if (started) throw new Error('External analysis has already started — this choice can no longer be changed.')
  entity.assessment.idiDocumentsAvailable = value
  entity.assessment.externalAgents.bench.depIds = value ? ['idiSynth'] : []
  recomputeWave1Locks(entity)
}

/**
 * Mirrors the HTML mock's recomputeLocks: an agent moves from 'locked' to runnable ('not_started') once
 * every dependency is approved and any uploadDep is satisfied. Never auto-triggers a run — the human still
 * has to hit "run" on the newly-eligible agent, matching the mock's explicit "nothing reruns automatically" rule.
 */
export function recomputeWave1Locks(entity: any) {
  for (const agentId of WAVE1_AGENT_IDS) {
    const agent = getWave1Agent(entity, agentId)
    if (agent.status !== 'locked') continue
    const deps: string[] = agent.depIds || []
    const depsDone = deps.every(id => isApproved(entity, id))
    const uploadDone = !agent.uploadDep || agent.uploadDep.done
    if (depsDone && uploadDone) agent.status = 'not_started'
  }
}

function buildTranscriptText(chatHistory: any[]): string {
  return (chatHistory || [])
    .map((m: any) => `${m.role === 'user' ? 'Reviewer' : 'Agent'}: ${m.content}`)
    .join('\n\n')
}

/**
 * Approving doesn't require the agent to have reached its final structured output — a human can decide the
 * conversation so far IS this agent's assessment at any point. If a structured version already exists, that's
 * what gets approved (as before). Otherwise this synthesizes a version from the raw chat transcript so
 * approvedVersion always points at a real versionHistory entry; downstream readers (getApprovedSummaryText,
 * the SWOT prompt) fall back to this transcript text when a version has no structured `result`.
 */
export function ensureApprovableVersion(agent: any): number {
  if (agent.versionHistory?.length) return agent.versionHistory[agent.versionHistory.length - 1].v
  if (!agent.versionHistory) agent.versionHistory = []
  const v = agent.versionHistory.length + 1
  agent.versionHistory.push({ v, result: null, text: buildTranscriptText(agent.chatHistory), createdAt: new Date().toISOString() })
  return v
}

/**
 * Reverses approve(): clears approval so the human can send this agent more messages and re-approve a
 * revised version. Blocked once the SWOT agent has actually run (produced a version) — SWOT already
 * consolidated this agent's approved output by then, so silently changing it underneath would leave the
 * consolidated SWOT stale. The SWOT agent itself has no such downstream in Wave 1, so it can always be
 * unlocked once approved.
 */
export function unlockWave1Agent(entity: any, agentId: string) {
  const agent = getWave1Agent(entity, agentId)
  if (agent.approvedVersion === null) throw new Error('This agent is not approved.')
  const swotAgent = getWave1Agent(entity, 'swot')
  if (agentId !== 'swot' && swotAgent.versionHistory?.length) {
    throw new Error('This agent can no longer be unlocked — the SWOT agent has already run using its approved output.')
  }
  agent.approvedVersion = null
  agent.approvedAt = null
  agent.approvedBy = null
  agent.status = 'complete'
}

/**
 * Wipes an agent's conversation and every draft it has produced, putting it back exactly where it
 * started ('not_started', or 'locked' if its deps aren't approved) — as if it had never been run.
 * Blocked once approved (unlock it first, mirroring the chat route's guard) so an approved snapshot
 * already handed to a downstream agent can't be wiped out from under it by accident.
 */
export function resetWave1Agent(entity: any, agentId: string) {
  const agent = getWave1Agent(entity, agentId)
  if (agent.approvedVersion !== null) {
    throw new Error('This agent is approved — unlock it first if you want to restart the discussion.')
  }
  const kind = agentKind(agentId)

  if (kind === 'pillar' || kind === 'fanout') {
    agent.aiScore = null
    // manualScore (the reviewer's own judgment) is intentionally not cleared here — it's independent of
    // any one AI draft and stays editable at any time (see setWave1ManualScore), including across restarts.
    agent.finalScore = computePillarFinalScore(null, agent.manualScore)
    agent.execSummary = { aiDraft: '', edited: '', useEdited: false }
    agent.elements = (agent.elements || []).map((el: any) => ({
      ...el, aiAnswer: '', evidenceQuote: '', sourceDocument: '', aiScore: null, scoreRationale: '', dataGap: null,
    }))
    agent.swot = { strengths: [], weaknesses: [], opportunities: [], threats: [] }
    if (kind === 'pillar') agent.interviewQuestions = { leadership: [], team: [], gapFilling: [] }
    agent.missingInfo = []
    agent.references = []
  } else if (kind === 'narrative') {
    agent.output = { aiDraft: '', edited: '' }
  } else {
    // swot: the consolidated result lives on the entity's assessment, not on the gate object itself.
    entity.assessment.consolidatedSwot = { strengths: [], weaknesses: [], opportunities: [], threats: [] }
    entity.assessment.strategicHypothesis = { aiDraft: '', edited: '' }
  }

  agent.chatHistory = []
  agent.versionHistory = []
  agent.discussionId = null
  const deps: string[] = agent.depIds || []
  const depsDone = deps.every(id => isApproved(entity, id))
  const uploadDone = !agent.uploadDep || agent.uploadDep.done
  agent.status = depsDone && uploadDone ? 'not_started' : 'locked'
}

function summarizePillarResult(name: string, result: any): string {
  const swot = result.swot || {}
  return `## ${name} (score: ${result.pillarScore ?? 'n/a'})
${result.executiveSummary || ''}
Strengths: ${(swot.strengths || []).join('; ') || 'none'}
Weaknesses: ${(swot.weaknesses || []).join('; ') || 'none'}
Opportunities: ${(swot.opportunities || []).join('; ') || 'none'}
Threats: ${(swot.threats || []).join('; ') || 'none'}`
}

/**
 * The text handed to downstream agents' prompts — always the frozen, human-approved version, never the
 * live draft. A later unapproved re-run of an upstream agent must not silently change what's already
 * flowed downstream; only approving a new version does that (and only once the human re-approves it).
 */
export function getApprovedSummaryText(entity: any, agentId: string): string {
  const kind = agentKind(agentId)
  const agent = getWave1Agent(entity, agentId)
  if (agent.approvedVersion === null) return ''
  const version = agent.versionHistory.find((v: any) => v.v === agent.approvedVersion)
  if (!version) return ''
  if (kind === 'narrative') return version.text
  // No structured result (approved straight from a mid-conversation chat, before the agent finalized a
  // scored/JSON output) — the transcript itself is the approved assessment.
  if (!version.result) return version.text || ''
  if (kind === 'swot') return `${JSON.stringify(version.result.consolidatedSwot)}\n\n${version.result.strategicHypothesis}`
  const name = kind === 'fanout' ? (FANOUT_NAMES[agentId] || agentId) : agent.name
  return summarizePillarResult(name, version.result)
}

/**
 * Runs (or re-runs) one Wave 1 agent for one entity: builds the right prompt and SiaGPT collectionIds for
 * that agent kind, calls SiaGPT, applies the result, and appends a new immutable version. Does NOT touch
 * chatHistory or approval state — callers (the run/chat routes) own that.
 *
 * Some pillar/fanout/SWOT assistants run their own internal multi-step, gated workflow server-side (e.g.
 * "Step A — Entity-Type Classification" / "HUMAN-IN-THE-LOOP GATE 1") and reply with plain text rather
 * than the final JSON schema until that internal workflow completes, or refuse outright when there's no
 * document evidence to ground the assessment in. That's not a failure — `final: false` signals it so the
 * caller shows the reply as a normal chat turn (no version/approval) instead of erroring the whole call.
 */
export async function runWave1Agent(
  project: any, entity: any, agentId: string, extraInstruction?: string
): Promise<{ version: number | null; preview: string; final: boolean; newSources: Record<string, any> }> {
  const kind = agentKind(agentId)
  const agent = getWave1Agent(entity, agentId)
  const entityProject = { entityName: entity.name, entityType: entity.type, assessment: entity.assessment, rubric: project.rubric }

  let prompt: string
  let assistantId: string | undefined
  let collectionIds: string[] = []

  if (kind === 'pillar') {
    prompt = buildAssessmentPrompt(entityProject, agentId)
    assistantId = config.pillarAssistantIds[agentId]
    collectionIds = entity.siagptCollectionId ? [entity.siagptCollectionId] : []
  } else if (agentId === 'idiGuide') {
    prompt = buildIdiGuidePrompt(entity)
    assistantId = config.assistantIds.idiGuide
    collectionIds = entity.siagptCollectionId ? [entity.siagptCollectionId] : []
  } else if (agentId === 'idiSynth') {
    const guideText = getApprovedSummaryText(entity, 'idiGuide')
    prompt = buildIdiSynthPrompt(entity, guideText)
    assistantId = config.assistantIds.idiSynth
    collectionIds = [entity.siagptCollectionId, entity.interviewCollectionId].filter(Boolean)
  } else if (kind === 'fanout') {
    // The fanout assistants (bench/pestel/marketSizing/competitor) carry their own rubric, persona, and
    // output-format instructions configured directly in the assistant — no need to restate them here.
    prompt = 'run'
    assistantId = (config.assistantIds as Record<string, string>)[agentId]
    collectionIds = [entity.siagptCollectionId, entity.interviewCollectionId].filter(Boolean)
  } else {
    // swotAgent.depIds gates this on every pillar and fan-out agent being approved first, so by the time
    // we get here each one's chatHistory is frozen exactly as it was approved — hand the SWOT assistant
    // those raw conversation transcripts directly rather than a pre-extracted score/SWOT summary.
    const pillarTranscripts = PILLAR_IDS.map(id => {
      const p = entity.assessment.pillars[id]
      return { pillar: `${id}: ${p.name}`, transcript: buildTranscriptText(p.chatHistory) }
    })
    const fanoutTranscripts = FANOUT_AGENT_IDS.map(id => {
      const agent = entity.assessment.externalAgents[id]
      return { name: FANOUT_NAMES[id], transcript: buildTranscriptText(agent.chatHistory) }
    })
    prompt = buildEntitySwotPrompt(entity, pillarTranscripts, fanoutTranscripts)
    assistantId = config.assistantIds.entitySwot
    collectionIds = []
  }

  // SiaGPT threads history server-side, keyed on discussionId — one discussion is opened per agent (on
  // its first turn) and reused for every later message to that same agent until it's reset, so we never
  // resend the transcript or restate the base prompt/rubric on follow-up turns; SiaGPT already has it.
  const isFirstTurn = !agent.discussionId
  if (extraInstruction) {
    if (isFirstTurn) {
      const instructionLabel = 'Instruction from the reviewer kicking off this agent — follow it and produce the complete output'
      prompt = kind === 'pillar'
        // The pillar assistant already has its persona and output schema configured in Langflow — send
        // just the reviewer's instruction plus the guiding rubric (`prompt` at this point), not a restated prompt.
        ? `${instructionLabel}:\n${extraInstruction}\n\n${prompt}`
        : `${prompt}\n\n${instructionLabel}:\n${extraInstruction}`
    } else {
      prompt = `Additional instruction from the reviewer — apply it and produce a revised, complete output (not just a description of the change):\n${extraInstruction}`
    }
  }

  const { text: rawText, newSources, discussionId } = await callSiaGPT(prompt, {
    assistantId, collectionIds, discussionId: agent.discussionId,
    // The SWOT assistant synthesizes purely from the transcripts embedded in the prompt — no document
    // collection is attached (see above), so the retrieval tools (rag/document_content/etc.) have nothing
    // to act on and are disabled outright rather than left to silently no-op.
    ...(kind === 'swot' ? { tools: [] } : {}),
    context: `wave1 ${entity.name} / ${agentId}`,
  })
  if (!agent.discussionId) agent.discussionId = discussionId

  if (kind === 'pillar') {
    let parsed: any, narrative: string
    try { ({ result: parsed, narrative } = parseJsonWithNarrative(rawText)) } catch { return { version: null, preview: rawText, final: false, newSources } }
    const result = parsed.pillarAssessment ?? parsed
    const v = applyEntityPillarResult(entity, agentId, result) as number
    return { version: v, preview: narrative || result.executiveSummary || '', final: true, newSources }
  }

  if (kind === 'fanout') {
    let parsed: any, narrative: string
    try { ({ result: parsed, narrative } = parseJsonWithNarrative(rawText)) } catch { return { version: null, preview: rawText, final: false, newSources } }
    const result = parsed.pillarAssessment ?? parsed
    const v = applyPillarLikeResult(entity.assessment.externalAgents[agentId], result)
    return { version: v, preview: narrative || result.executiveSummary || '', final: true, newSources }
  }

  if (kind === 'narrative') {
    agent.output = { aiDraft: rawText, edited: rawText }
    agent.status = 'complete'
    const v = agent.versionHistory.length + 1
    agent.versionHistory.push({ v, text: rawText, createdAt: new Date().toISOString() })
    return { version: v, preview: rawText, final: true, newSources }
  }

  // swot
  let parsed: any, narrative: string
  try { ({ result: parsed, narrative } = parseJsonWithNarrative(rawText)) } catch { return { version: null, preview: rawText, final: false, newSources } }
  entity.assessment.consolidatedSwot = parsed.consolidatedSwot
  entity.assessment.strategicHypothesis = { aiDraft: parsed.strategicHypothesis, edited: parsed.strategicHypothesis }
  const gate = entity.assessment.swotAgent
  gate.status = 'complete'
  const v = gate.versionHistory.length + 1
  gate.versionHistory.push({ v, result: { consolidatedSwot: parsed.consolidatedSwot, strategicHypothesis: parsed.strategicHypothesis }, createdAt: new Date().toISOString() })
  return { version: v, preview: narrative || parsed.strategicHypothesis || '', final: true, newSources }
}
