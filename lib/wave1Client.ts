'use client'
// Shared client-side helpers for the Wave 1 (Diagnostic) pipeline — used by both DashboardPage (the entity
// portfolio) and AssessmentPage (a single entity's wave workspace) so entity/agent shape logic lives in one place.

export const ENTITY_TYPES = [
  { value: 'government', label: 'Government Ministry / Authority' },
  { value: 'holding', label: 'Holding Company' },
  { value: 'corporate', label: 'Corporate / Private Sector' },
  { value: 'ngo', label: 'NGO / Non-Profit' },
  { value: 'other', label: 'Other' },
]

export const PILLAR_ORDER = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8']
export const FANOUT_ORDER = ['bench', 'pestel', 'marketSizing', 'competitor']
export const FANOUT_LABELS: Record<string, string> = {
  bench: 'Benchmarking', pestel: 'PESTEL', marketSizing: 'Market sizing', competitor: 'Competitor analysis',
}

/** Undecided (null) behaves like `true` — the interview-guide path is the historical default, so
 *  existing entities (and a fresh entity before the reviewer answers) keep running it unchanged. */
export function idiPathEnabled(entity: any): boolean {
  return entity.assessment.idiDocumentsAvailable !== false
}

/** The IDI Guide/Synth steps only exist in the Wave 1 sequence when the reviewer has documents to seed
 *  an interview guide from; when they don't, external analysis runs straight off company documents. */
export function wave1Sequence(entity: any): string[] {
  const idi = idiPathEnabled(entity) ? ['idiGuide', 'idiSynth'] : []
  return [...PILLAR_ORDER, ...idi, ...FANOUT_ORDER, 'swot']
}

export function wave1Total(entity: any): number {
  return PILLAR_ORDER.length + (idiPathEnabled(entity) ? 2 : 0) + FANOUT_ORDER.length + 1 /* swot */
}

/** Client-side mirror of the server's resolveWave1Entity('main', ...) adapter — the project's own primary/
 *  holding entity (project.entityName/entityType/assessment/documents), rebuilt fresh from `project` on
 *  every render so it always reflects the latest fetch. Read-only here; mutations happen via the API. */
export function mainEntityAdapter(project: any): any {
  return {
    id: 'main',
    name: project.entityName,
    type: project.entityType,
    assessment: project.assessment,
    documents: project.documents || [],
    siagptCollectionId: project.siagptCollectionId,
    interviewCollectionId: project.interviewCollectionId,
  }
}

export function getAgentObj(entity: any, id: string): any {
  if (id === 'swot') return entity.assessment.swotAgent
  if (entity.assessment.pillars[id]) return entity.assessment.pillars[id]
  return entity.assessment.externalAgents[id]
}

export function agentLabel(entity: any, id: string): string {
  if (id === 'swot') return 'SWOT — analysis & focus areas'
  if (id === 'idiGuide') return 'IDI Guide'
  if (id === 'idiSynth') return 'IDI Synth — interview synthesis'
  if (FANOUT_LABELS[id]) return FANOUT_LABELS[id]
  return entity.assessment.pillars[id]?.name || id
}

export function isApproved(entity: any, id: string): boolean {
  return getAgentObj(entity, id).approvedVersion !== null
}

/** Mirrors the server's unlockWave1Agent gate: an approved agent can be unlocked for more conversation
 *  right up until the SWOT agent has actually run off its approved output — the SWOT agent itself has
 *  no such downstream in Wave 1, so it stays unlockable regardless. */
export function canUnlock(entity: any, id: string): boolean {
  if (id === 'swot') return true
  return !hasVersion(getAgentObj(entity, 'swot'))
}

export function hasVersion(agent: any): boolean {
  return (agent.versionHistory?.length || 0) > 0
}

export function wave1ApprovedCount(entity: any): number {
  return wave1Sequence(entity).filter(id => isApproved(entity, id)).length
}

export function statusMeta(agent: any): { label: string; color: string } {
  if (agent.approvedVersion !== null) return { label: 'Approved', color: 'var(--sia-green)' }
  if (agent.status === 'locked') return { label: 'Locked', color: 'var(--sia-medium-gray)' }
  if (agent.status === 'in_progress') return { label: 'Running…', color: 'var(--sia-medium-teal)' }
  if (agent.status === 'complete') return { label: 'Awaiting review', color: 'var(--sia-amber)' }
  return { label: 'Not started', color: 'var(--sia-medium-gray)' }
}

// The message sent when the reviewer clicks "Run" instead of typing their own kickoff instruction —
// still goes through the normal chat endpoint (with the entity's collection id attached server-side),
// it's just a sensible default first turn rather than an autonomous trigger.
export function defaultKickoffMessage(agentId: string, entity: any): string {
  if (PILLAR_ORDER.includes(agentId)) return 'Run the full pillar assessment against the uploaded documents — score every element and flag data gaps.'
  if (agentId === 'idiGuide') return 'Generate the interview guide from the uploaded documents.'
  if (agentId === 'idiSynth') return 'Synthesize the uploaded interview transcripts together with the approved interview guide.'
  // bench/pestel/marketSizing/competitor assistants carry their own rubric, persona, and output-format
  // instructions configured directly in the assistant — no need to restate them here, just trigger the run.
  if (FANOUT_ORDER.includes(agentId)) return 'Run.'
  if (agentId === 'swot') return 'Consolidate the approved pillar and external-analysis outputs into the entity-level SWOT.'
  return 'Run the assessment.'
}
