import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore'
import { RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer, Tooltip } from 'recharts'
import { Search, Play, AlertTriangle, TrendingUp, FileText, Loader2, CheckCircle, XCircle, FileWarning, Plus, Trash2, ChevronDown, ChevronUp, Building2 } from 'lucide-react'
import { aiApi, projectsApi, entitiesApi } from '../api'
import type { SubsidiaryEntity } from '../store/useStore'
import { CitedText } from '../components/CitedText'
import { startPillarAssessment, startBatchAssessment, startEntitiesAssessment } from '../services/assessmentService'

const PILLAR_ICONS: Record<string, string> = { P1:'🎯', P2:'🏛', P3:'💰', P4:'🗺', P5:'⚙️', P6:'👥', P7:'🛡', P8:'🚀' }
const RAG_COLORS: Record<string, string> = { red: 'var(--sia-red)', amber: 'var(--sia-amber)', green: 'var(--sia-green)', gray: 'var(--sia-medium-gray)' }
const RAG_LABELS: Record<string, string> = { red: 'Critical', amber: 'Developing', green: 'Strong', gray: 'Not Assessed' }

const ENTITY_TYPES = [
  { value: 'government', label: 'Government Ministry / Authority' },
  { value: 'holding', label: 'Holding Company' },
  { value: 'corporate', label: 'Corporate / Private Sector' },
  { value: 'ngo', label: 'NGO / Non-Profit' },
  { value: 'other', label: 'Other' },
]

function entityOverallScore(entity: SubsidiaryEntity): number | null {
  const pillars = Object.values(entity.assessment.pillars)
  const scored = pillars.filter(p => p.finalScore !== null)
  if (!scored.length) return null
  return parseFloat((scored.reduce((s, p) => s + (p.finalScore || 0), 0) / scored.length).toFixed(1))
}

function entityCompletion(entity: SubsidiaryEntity): number {
  const pillars = Object.values(entity.assessment.pillars)
  return Math.round((pillars.filter(p => p.status === 'complete').length / pillars.length) * 100)
}

export default function Dashboard() {
  const navigate = useNavigate()
  const { project, setProject, getOverallScore, getCompletionPercent, getRag, activeEntityId, setActiveEntityId, setSourcesOpen, setActiveSourceNum, pendingWarnings, setPendingWarnings } = useStore()
  const [runningAll, setRunningAll] = useState(false)
  const [runningPillars, setRunningPillars] = useState<Set<string>>(new Set())
  const [runProgress, setRunProgress] = useState<{ done: number; total: number; errors: string[] } | null>(null)
  const [streamLog, setStreamLog] = useState('')

  // Multi-entity state
  const [selectedEntityIds, setSelectedEntityIds] = useState<Set<string>>(new Set())
  const [runningEntityIds, setRunningEntityIds] = useState<Set<string>>(new Set())
  const [entityProgress, setEntityProgress] = useState<Record<string, { done: number; total: number; errors: string[] }>>({})
  const [entitiesRunning, setEntitiesRunning] = useState(false)
  const [entityErrors, setEntityErrors] = useState<string[]>([])
  const [showAddEntity, setShowAddEntity] = useState(false)
  const [newEntityName, setNewEntityName] = useState('')
  const [newEntityType, setNewEntityType] = useState('corporate')
  const [addingEntity, setAddingEntity] = useState(false)
  const [addEntityError, setAddEntityError] = useState('')
  const [expandedEntities, setExpandedEntities] = useState<Set<string>>(new Set())

  if (!project) return null

  const entities: SubsidiaryEntity[] = project.entities || []

  // Dismissable banner for entities that failed collection creation during project initialisation
  const warningBanner = pendingWarnings.length > 0 ? (
    <div style={{ margin: '0 0 20px', padding: '14px 18px', borderRadius: 'var(--radius)', background: '#FEF3C7', border: '1px solid #FCD34D', display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
      <AlertTriangle size={18} color="#B45309" style={{ flexShrink: 0, marginTop: '1px' }} />
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 700, fontSize: '13px', color: '#92400E', marginBottom: '4px' }}>Some entities were not added</div>
        {pendingWarnings.map((w, i) => <div key={i} style={{ fontSize: '13px', color: '#78350F' }}>{w}</div>)}
      </div>
      <button onClick={() => setPendingWarnings([])} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#B45309', fontSize: '18px', lineHeight: 1, padding: 0, marginLeft: '4px' }} title="Dismiss">✕</button>
    </div>
  ) : null
  const activeEntity = activeEntityId ? entities.find(e => e.id === activeEntityId) : null
  const pillars = activeEntity ? activeEntity.assessment.pillars : project.assessment.pillars
  const overallScore = activeEntity ? entityOverallScore(activeEntity) : getOverallScore()
  const completion = activeEntity ? entityCompletion(activeEntity) : getCompletionPercent()
  // Always reflect main entity for the entity table's holding row
  const mainOverallScore = getOverallScore()
  const mainCompletion = getCompletionPercent()

  const radarData = Object.entries(pillars).map(([id, p]: [string, any]) => ({
    subject: id,
    score: p.finalScore || 0,
    fullMark: 5
  }))

  const hasDocuments = activeEntity
    ? (activeEntity.documents && activeEntity.documents.length > 0)
    : (project.documents && project.documents.length > 0)
  const effectiveDocuments = activeEntity ? (activeEntity.documents || []) : (project.documents || [])
  const docWarnings = effectiveDocuments.filter((d: any) => !d.extractedText || d.extractedText.length < 100)

  const HOLDING_ID = '__holding__'

  async function runSinglePillar(pillarId: string) {
    if (!hasDocuments) {
      alert('Please upload at least one document in Project Setup before running an assessment.')
      return
    }
    setRunningPillars(prev => new Set(prev).add(pillarId))
    setStreamLog('')
    startPillarAssessment(
      project!.id,
      activeEntity?.id ?? null,
      pillarId,
      {
        onChunk: (chunk) => setStreamLog(prev => prev + chunk),
        onDone: () => { setStreamLog(''); setRunningPillars(prev => { const n = new Set(prev); n.delete(pillarId); return n }) },
        onError: (err) => {
          alert(`Pillar ${pillarId} failed:\n${err}\n\nYou can try again using the Run button.`)
          setRunningPillars(prev => { const n = new Set(prev); n.delete(pillarId); return n })
          setStreamLog('')
        },
      }
    )
  }

  async function runAllPillars() {
    if (!hasDocuments) {
      alert('Please upload at least one document in Project Setup before running assessments.')
      return
    }
    const pillarIds = Object.keys(pillars)
    setRunningAll(true)
    setRunningPillars(new Set(pillarIds))
    setRunProgress({ done: 0, total: pillarIds.length, errors: [] })
    const errors: string[] = []
    let doneCount = 0

    startBatchAssessment(
      project!.id,
      activeEntity?.id ?? null,
      pillarIds,
      {
        onPillarUpdate: (pillarId, status) => {
          doneCount++
          setRunningPillars(prev => { const next = new Set(prev); next.delete(pillarId); return next })
          if (status === 'error') errors.push(`${pillarId}: failed`)
          setRunProgress({ done: doneCount, total: pillarIds.length, errors: [...errors] })
        },
        onDone: (failedIds) => {
          if (failedIds.length > 0) {
            const pillarMap = useStore.getState().project?.assessment?.pillars || {}
            failedIds.forEach((id: string) => {
              const name = pillarMap[id]?.name
              if (!errors.some((e: string) => e.startsWith(id + ':'))) {
                errors.push(`${id}${name ? ` (${name})` : ''}: failed after retries`)
              }
            })
          }
          setRunningPillars(new Set())
          setRunningAll(false)
          setStreamLog('')
          if (errors.length > 0) {
            setRunProgress({ done: pillarIds.length, total: pillarIds.length, errors })
          } else {
            setTimeout(() => setRunProgress(null), 4000)
          }
        },
        onError: (err) => {
          errors.push(err)
          setRunningPillars(new Set())
          setRunningAll(false)
          setStreamLog('')
        },
      }
    )
  }

  // Run assessments for selected or all entities (including holding company)
  async function runEntityAssessments(entityIds?: string[]) {
    const allIds = entityIds || (selectedEntityIds.size > 0 ? Array.from(selectedEntityIds) : [HOLDING_ID, ...entities.map(e => e.id)])
    if (allIds.length === 0) { alert('No entities to assess.'); return }

    const runHolding = allIds.includes(HOLDING_ID)
    const subEntityIds = allIds.filter(id => id !== HOLDING_ID)

    // Start holding company assessment via service (module-level, survives navigation)
    if (runHolding) runAllPillars()

    if (subEntityIds.length === 0) return

    const targetIds = subEntityIds
    setEntitiesRunning(true)
    setEntityErrors([])
    const runningSet = new Set(targetIds)
    setRunningEntityIds(runningSet)
    const initProgress: Record<string, { done: number; total: number; errors: string[] }> = {}
    targetIds.forEach(id => { initProgress[id] = { done: 0, total: 8, errors: [] } })
    setEntityProgress(initProgress)
    const errors: string[] = []

    startEntitiesAssessment(
      project!.id,
      targetIds,
      {
        onEntityPillarProgress: (entityId, pillarId, status) => {
          setEntityProgress(prev => ({
            ...prev,
            [entityId]: {
              ...prev[entityId],
              done: (prev[entityId]?.done || 0) + 1,
              errors: status === 'error'
                ? [...(prev[entityId]?.errors || []), `${pillarId}: failed`]
                : (prev[entityId]?.errors || []),
            }
          }))
          if (status === 'error') {
            setRunningEntityIds(prev => { const n = new Set(prev); n.delete(entityId); return n })
          }
        },
        onDone: () => {
          setRunningEntityIds(new Set())
          setEntitiesRunning(false)
          if (!errors.length) setTimeout(() => setEntityProgress({}), 5000)
        },
        onError: (err) => {
          errors.push(err)
          setEntityErrors([...errors])
          setEntitiesRunning(false)
        },
      }
    )
  }

  async function handleAddEntity() {
    if (!newEntityName.trim()) return
    setAddingEntity(true)
    setAddEntityError('')
    try {
      await entitiesApi.add(project!.id, { name: newEntityName.trim(), type: newEntityType })
      const res = await projectsApi.get(project!.id)
      setProject(res.data)
      setNewEntityName('')
      setNewEntityType('corporate')
      setAddEntityError('')
      setShowAddEntity(false)
    } catch (e: any) {
      setAddEntityError(e.response?.data?.error || 'Failed to add entity. Please try again.')
    } finally {
      setAddingEntity(false)
    }
  }

  async function handleRemoveEntity(entityId: string, entityName: string) {
    if (!confirm(`Remove entity "${entityName}"? This will delete all its documents and assessment data.`)) return
    try {
      await entitiesApi.remove(project!.id, entityId)
      const res = await projectsApi.get(project!.id)
      setProject(res.data)
      setSelectedEntityIds(prev => { const next = new Set(prev); next.delete(entityId); return next })
    } catch (e: any) {
      alert('Failed to remove entity: ' + e.message)
    }
  }

  function toggleEntitySelection(entityId: string) {
    setSelectedEntityIds(prev => {
      const next = new Set(prev)
      next.has(entityId) ? next.delete(entityId) : next.add(entityId)
      return next
    })
  }

  function toggleEntityExpand(entityId: string) {
    setExpandedEntities(prev => {
      const next = new Set(prev)
      next.has(entityId) ? next.delete(entityId) : next.add(entityId)
      return next
    })
  }

  const allThreats = Object.values(pillars).flatMap((p: any) => (p.swot?.threats || []).map((t: string) => ({ text: t, pillar: p.name })))
  const allOpportunities = Object.values(pillars).flatMap((p: any) => (p.swot?.opportunities || []).map((o: string) => ({ text: o, pillar: p.name })))

  return (
    <div style={{ flex: 1, overflow: 'auto', padding: '32px', maxWidth: '1400px' }}>
      {warningBanner}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: activeEntity ? '16px' : '32px' }}>
        <div>
          <div style={{ fontSize: '12px', color: 'var(--sia-medium-gray)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '6px', fontWeight: 600 }}>Assessment Dashboard</div>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '32px', fontWeight: 800, color: 'var(--sia-navy)', marginBottom: '4px' }}>
            {activeEntity ? activeEntity.name : project.entityName}
          </h1>
          <div style={{ fontSize: '14px', color: 'var(--sia-cool-gray)' }}>
            {activeEntity ? `Subsidiary of ${project.entityName} · ${project.name}` : `${project.name}${project.consultantName ? ` • ${project.consultantName}` : ''}`}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '10px' }}>
          <button className="btn btn-ghost" data-testid="button-manage-docs" onClick={() => navigate('/app/setup')}>
            <FileText size={14} /> Manage Documents
          </button>
        </div>
      </div>

      {/* Active entity context banner */}
      {activeEntity && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 16px', background: 'rgba(139,92,246,0.08)', border: '1px solid rgba(139,92,246,0.25)', borderRadius: '10px', marginBottom: '28px' }}>
          <Building2 size={15} color="#8B5CF6" />
          <span style={{ fontSize: '13px', fontWeight: 700, color: '#6D28D9' }}>{activeEntity.name}</span>
          <span style={{ fontSize: '13px', color: '#7C3AED' }}>· Subsidiary Entity View</span>
          <span style={{ fontSize: '11px', color: '#8B5CF6', background: 'rgba(139,92,246,0.1)', padding: '2px 8px', borderRadius: '4px', fontWeight: 600, marginLeft: '4px' }}>{activeEntity.type}</span>
          <button
            onClick={() => setActiveEntityId(null)}
            style={{ marginLeft: 'auto', fontSize: '11px', color: '#8B5CF6', background: 'rgba(139,92,246,0.1)', border: '1px solid rgba(139,92,246,0.25)', padding: '3px 10px', borderRadius: '4px', cursor: 'pointer', fontWeight: 600 }}
          >
            ← Back to Main Entity
          </button>
        </div>
      )}

      {/* ====== MULTI-ENTITY SECTION ====== */}
      {
        <div className="card" style={{ padding: '24px', marginBottom: '28px', border: '1px solid rgba(0,222,204,0.2)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <Building2 size={18} color="var(--sia-teal)" />
              <span style={{ fontSize: '15px', fontWeight: 700, color: 'var(--sia-navy)', fontFamily: 'var(--font-display)' }}>
                Assessment Entities
              </span>
              <span style={{ background: 'rgba(0,222,204,0.1)', color: 'var(--sia-teal)', padding: '2px 10px', borderRadius: '999px', fontSize: '12px', fontWeight: 700 }}>
                {1 + entities.length} entit{(1 + entities.length) === 1 ? 'y' : 'ies'}
              </span>
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              {selectedEntityIds.size > 0 && (
                <button className="btn btn-ghost btn-sm" style={{ color: 'var(--sia-cool-gray)' }} onClick={() => setSelectedEntityIds(new Set())}>
                  Clear Selection
                </button>
              )}
              <button className="btn btn-ghost btn-sm" style={{ borderColor: 'rgba(0,222,204,0.3)', color: 'var(--sia-teal)' }}
                disabled={entitiesRunning || runningAll || selectedEntityIds.size === 0}
                onClick={() => runEntityAssessments(Array.from(selectedEntityIds))}>
                {(entitiesRunning || runningAll) ? <Loader2 size={12} className="spinner" /> : <Play size={12} />}
                Run Selected ({selectedEntityIds.size})
              </button>
              <button className="btn btn-primary btn-sm" disabled={entitiesRunning || runningAll}
                onClick={() => runEntityAssessments()}>
                {(entitiesRunning || runningAll) ? <><Loader2 size={12} className="spinner" /> Running...</> : <><Play size={12} /> Run All Assessments</>}
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowAddEntity(v => !v)}>
                <Plus size={12} /> Add Entity
              </button>
            </div>
          </div>

          {/* Add entity inline form */}
          {showAddEntity && (
            <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end', padding: '14px', background: 'rgba(0,222,204,0.04)', border: '1px solid rgba(0,222,204,0.15)', borderRadius: 'var(--radius)', marginBottom: '14px' }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '11px', color: 'var(--sia-medium-gray)', fontWeight: 600, marginBottom: '4px' }}>ENTITY NAME</div>
                <input className="form-input" placeholder="e.g. Subsidiary Name" value={newEntityName}
                  onChange={e => setNewEntityName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleAddEntity()}
                  style={{ fontSize: '13px' }} />
              </div>
              <div style={{ width: '200px' }}>
                <div style={{ fontSize: '11px', color: 'var(--sia-medium-gray)', fontWeight: 600, marginBottom: '4px' }}>TYPE</div>
                <select className="form-input form-select" value={newEntityType} onChange={e => setNewEntityType(e.target.value)} style={{ fontSize: '13px' }}>
                  {ENTITY_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
              <button className="btn btn-primary btn-sm" onClick={handleAddEntity} disabled={addingEntity || !newEntityName.trim()}>
                {addingEntity ? <Loader2 size={12} className="spinner" /> : <Plus size={12} />}
                Add
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => { setShowAddEntity(false); setNewEntityName(''); setAddEntityError('') }}>Cancel</button>
            </div>
          )}
          {addEntityError && showAddEntity && (
            <div style={{ margin: '-10px 0 14px', padding: '10px 14px', borderRadius: 'var(--radius)', background: '#FEF2F2', border: '1px solid #FECACA', color: '#B91C1C', fontSize: '13px', display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
              <AlertTriangle size={14} color="#B91C1C" style={{ flexShrink: 0, marginTop: '1px' }} />
              <span>{addEntityError}</span>
            </div>
          )}

          {/* Entity progress banner */}
          {entitiesRunning && Object.keys(entityProgress).length > 0 && (
            <div style={{ background: 'rgba(0,222,204,0.06)', border: '1px solid rgba(0,222,204,0.2)', borderRadius: 'var(--radius)', padding: '12px 16px', marginBottom: '14px', display: 'flex', alignItems: 'center', gap: '10px' }}>
              <Loader2 size={16} color="var(--sia-teal)" className="spinner" />
              <div>
                <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--sia-teal)' }}>
                  Assessing {Object.keys(entityProgress).length} entities in parallel — {Object.values(entityProgress).reduce((s, p) => s + p.done, 0)} / {Object.values(entityProgress).reduce((s, p) => s + p.total, 0)} pillars complete
                </div>
                <div style={{ fontSize: '11px', color: 'var(--sia-medium-gray)', marginTop: '2px' }}>
                  {Object.entries(entityProgress).map(([entityId, prog]) => {
                    const entity = entities.find(e => e.id === entityId)
                    return entity ? `${entity.name}: ${prog.done}/8` : ''
                  }).filter(Boolean).join(' · ')}
                </div>
              </div>
            </div>
          )}

          {entityErrors.length > 0 && (
            <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 'var(--radius)', padding: '10px 14px', marginBottom: '14px' }}>
              {entityErrors.map((err, i) => <div key={i} style={{ fontSize: '12px', color: '#991B1B' }}>• {err}</div>)}
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {/* Header row */}
              <div style={{ display: 'grid', gridTemplateColumns: '32px 1fr 120px 160px 120px 100px', gap: '8px', padding: '6px 12px', fontSize: '11px', color: 'var(--sia-medium-gray)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                <div></div>
                <div>Entity</div>
                <div>Overall Score</div>
                <div>Completion</div>
                <div>Documents</div>
                <div style={{ textAlign: 'right' }}>Actions</div>
              </div>

              {/* Holding company row */}
              {(() => {
                const holdingScore = mainOverallScore ? parseFloat(mainOverallScore) : null
                const holdingRag = getRag(holdingScore)
                const isHoldingSelected = selectedEntityIds.has(HOLDING_ID)
                const isHoldingExpanded = expandedEntities.has(HOLDING_ID)
                return (
                  <div key={HOLDING_ID} style={{ border: `1px solid ${isHoldingSelected ? 'rgba(0,222,204,0.4)' : 'rgba(25,71,125,0.2)'}`, borderRadius: 'var(--radius)', overflow: 'hidden', background: isHoldingSelected ? 'rgba(0,222,204,0.03)' : 'rgba(25,71,125,0.02)', transition: 'all 0.15s' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '32px 1fr 120px 160px 120px 100px', gap: '8px', padding: '12px', alignItems: 'center' }}>
                      <input type="checkbox" checked={isHoldingSelected} onChange={() => toggleEntitySelection(HOLDING_ID)}
                        style={{ width: '16px', height: '16px', cursor: 'pointer', accentColor: 'var(--sia-teal)' }} />
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--sia-navy)' }}>{project.entityName}</span>
                          <span style={{ fontSize: '10px', padding: '1px 6px', borderRadius: '999px', background: 'rgba(25,71,125,0.1)', color: 'var(--sia-navy)', fontWeight: 700, letterSpacing: '0.3px', textTransform: 'uppercase' }}>Holding Co.</span>
                        </div>
                        <div style={{ fontSize: '11px', color: 'var(--sia-medium-gray)', marginTop: '1px' }}>{ENTITY_TYPES.find(t => t.value === project.entityType)?.label || project.entityType}</div>
                        {runningAll && runProgress && (
                          <div style={{ fontSize: '11px', color: 'var(--sia-teal)', marginTop: '2px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <Loader2 size={10} className="spinner" /> {runProgress.done}/{runProgress.total} pillars
                          </div>
                        )}
                      </div>
                      <div style={{ fontFamily: 'var(--font-display)', fontSize: '20px', fontWeight: 800, color: holdingScore ? RAG_COLORS[holdingRag] : 'var(--sia-medium-gray)' }}>
                        {holdingScore ? `${holdingScore}/5` : '—'}
                      </div>
                      <div>
                        <div style={{ fontSize: '12px', color: 'var(--sia-cool-gray)', marginBottom: '4px' }}>{mainCompletion}% complete</div>
                        <div className="progress-bar" style={{ height: '4px' }}>
                          <div className="progress-fill" style={{ width: `${mainCompletion}%`, background: mainCompletion === 100 ? 'var(--sia-green)' : 'var(--sia-teal)' }} />
                        </div>
                      </div>
                      <div style={{ fontSize: '12px', color: project.documents.length > 0 ? 'var(--sia-navy)' : 'var(--sia-medium-gray)', fontWeight: project.documents.length > 0 ? 600 : 400 }}>
                        {project.documents.length} doc{project.documents.length !== 1 ? 's' : ''}
                      </div>
                      <div style={{ display: 'flex', gap: '4px', justifyContent: 'flex-end', alignItems: 'center' }}>
                        <button title={isHoldingExpanded ? 'Collapse' : 'View pillars'}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--sia-cool-gray)', padding: '3px', display: 'flex' }}
                          onClick={() => toggleEntityExpand(HOLDING_ID)}>
                          {isHoldingExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                        </button>
                        <button
                          title="Switch to main entity view"
                          className="btn btn-sm"
                          style={{ padding: '3px 8px', background: !activeEntityId ? 'rgba(0,222,204,0.15)' : 'rgba(0,222,204,0.06)', border: `1px solid ${!activeEntityId ? 'rgba(0,222,204,0.5)' : 'rgba(0,222,204,0.25)'}`, color: 'var(--sia-teal)', fontSize: '11px', fontWeight: 600 }}
                          onClick={() => setActiveEntityId(null)}>
                          {!activeEntityId ? '✓ Viewing' : 'View'}
                        </button>
                        <button title="Run all pillars for holding company"
                          className="btn btn-sm"
                          style={{ padding: '3px 8px', background: 'rgba(0,222,204,0.08)', border: '1px solid rgba(0,222,204,0.3)', color: 'var(--sia-teal)', fontSize: '11px', fontWeight: 600 }}
                          disabled={runningAll || entitiesRunning}
                          onClick={runAllPillars}>
                          {runningAll ? <Loader2 size={10} className="spinner" /> : <Play size={10} />}
                        </button>
                        <button title="Manage holding company documents"
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--sia-cool-gray)', padding: '3px', display: 'flex' }}
                          onClick={() => navigate('/app/setup')}>
                          <FileText size={13} />
                        </button>
                      </div>
                    </div>
                    {isHoldingExpanded && (
                      <div style={{ borderTop: '1px solid rgba(69,85,105,0.08)', padding: '12px 12px 12px 52px', background: 'var(--sia-light-gray)' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '6px' }}>
                          {Object.entries(pillars).map(([pid, p]: [string, any]) => {
                            const pRag = getRag(p.finalScore)
                            return (
                              <div key={pid} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 8px', background: 'white', borderRadius: 'var(--radius)', border: '1px solid rgba(69,85,105,0.1)' }}>
                                <span style={{ fontSize: '13px' }}>{PILLAR_ICONS[pid]}</span>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <div style={{ fontSize: '10px', color: 'var(--sia-medium-gray)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name.split(' ').slice(0,2).join(' ')}</div>
                                </div>
                                <span style={{ fontSize: '12px', fontWeight: 700, color: RAG_COLORS[pRag], minWidth: '24px', textAlign: 'right' }}>
                                  {p.finalScore ? p.finalScore.toFixed(1) : '—'}
                                </span>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                )
              })()}

              {entities.length === 0 && (
                <div style={{ padding: '20px', textAlign: 'center', color: 'var(--sia-medium-gray)', fontSize: '13px', borderTop: '1px solid rgba(69,85,105,0.08)', marginTop: '6px' }}>
                  No subsidiary entities yet. Click "Add Entity" to add subsidiaries.
                </div>
              )}

              {entities.map((entity) => {
                const score = entityOverallScore(entity)
                const comp = entityCompletion(entity)
                const rag = getRag(score)
                const isRunning = runningEntityIds.has(entity.id)
                const isSelected = selectedEntityIds.has(entity.id)
                const isExpanded = expandedEntities.has(entity.id)
                const prog = entityProgress[entity.id]
                return (
                  <div key={entity.id} style={{ border: `1px solid ${isSelected ? 'rgba(0,222,204,0.4)' : 'rgba(69,85,105,0.12)'}`, borderRadius: 'var(--radius)', overflow: 'hidden', background: isSelected ? 'rgba(0,222,204,0.03)' : 'white', transition: 'all 0.15s' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '32px 1fr 120px 160px 120px 100px', gap: '8px', padding: '12px', alignItems: 'center' }}>
                      {/* Checkbox */}
                      <input type="checkbox" checked={isSelected} onChange={() => toggleEntitySelection(entity.id)}
                        style={{ width: '16px', height: '16px', cursor: 'pointer', accentColor: 'var(--sia-teal)' }} />
                      {/* Entity name */}
                      <div>
                        <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--sia-navy)' }}>{entity.name}</div>
                        <div style={{ fontSize: '11px', color: 'var(--sia-medium-gray)', marginTop: '1px' }}>{ENTITY_TYPES.find(t => t.value === entity.type)?.label || entity.type}</div>
                        {isRunning && prog && (
                          <div style={{ fontSize: '11px', color: 'var(--sia-teal)', marginTop: '2px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <Loader2 size={10} className="spinner" /> {prog.done}/{prog.total} pillars
                          </div>
                        )}
                      </div>
                      {/* Score */}
                      <div style={{ fontFamily: 'var(--font-display)', fontSize: '20px', fontWeight: 800, color: score ? RAG_COLORS[rag] : 'var(--sia-medium-gray)' }}>
                        {score ? `${score}/5` : '—'}
                      </div>
                      {/* Completion bar */}
                      <div>
                        <div style={{ fontSize: '12px', color: 'var(--sia-cool-gray)', marginBottom: '4px' }}>{comp}% complete</div>
                        <div className="progress-bar" style={{ height: '4px' }}>
                          <div className="progress-fill" style={{ width: `${comp}%`, background: comp === 100 ? 'var(--sia-green)' : 'var(--sia-teal)' }} />
                        </div>
                      </div>
                      {/* Documents */}
                      <div style={{ fontSize: '12px', color: entity.documents.length > 0 ? 'var(--sia-navy)' : 'var(--sia-medium-gray)', fontWeight: entity.documents.length > 0 ? 600 : 400 }}>
                        {entity.documents.length} doc{entity.documents.length !== 1 ? 's' : ''}
                      </div>
                      {/* Actions */}
                      <div style={{ display: 'flex', gap: '4px', justifyContent: 'flex-end', alignItems: 'center' }}>
                        <button title={isExpanded ? 'Collapse' : 'View pillars'}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--sia-cool-gray)', padding: '3px', display: 'flex' }}
                          onClick={() => toggleEntityExpand(entity.id)}>
                          {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                        </button>
                        <button
                          title="Switch to this entity's view"
                          className="btn btn-sm"
                          style={{ padding: '3px 8px', background: activeEntityId === entity.id ? 'rgba(139,92,246,0.15)' : 'rgba(139,92,246,0.06)', border: `1px solid ${activeEntityId === entity.id ? 'rgba(139,92,246,0.5)' : 'rgba(139,92,246,0.25)'}`, color: '#7C3AED', fontSize: '11px', fontWeight: 600 }}
                          onClick={() => setActiveEntityId(activeEntityId === entity.id ? null : entity.id)}>
                          {activeEntityId === entity.id ? '✓ Viewing' : 'View'}
                        </button>
                        <button title="Run all pillars for this entity"
                          className="btn btn-sm"
                          style={{ padding: '3px 8px', background: 'rgba(0,222,204,0.08)', border: '1px solid rgba(0,222,204,0.3)', color: 'var(--sia-teal)', fontSize: '11px', fontWeight: 600 }}
                          disabled={isRunning || entitiesRunning}
                          onClick={() => runEntityAssessments([entity.id])}>
                          {isRunning ? <Loader2 size={10} className="spinner" /> : <Play size={10} />}
                        </button>
                        <button title="Manage entity documents"
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--sia-cool-gray)', padding: '3px', display: 'flex' }}
                          onClick={() => navigate('/app/setup')}>
                          <FileText size={13} />
                        </button>
                        <button title="Remove entity"
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--sia-red)', padding: '3px', display: 'flex' }}
                          onClick={() => handleRemoveEntity(entity.id, entity.name)}>
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>

                    {/* Expanded pillar detail */}
                    {isExpanded && (
                      <div style={{ borderTop: '1px solid rgba(69,85,105,0.08)', padding: '12px 12px 12px 52px', background: 'var(--sia-light-gray)' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '6px' }}>
                          {Object.entries(entity.assessment.pillars).map(([pid, p]: [string, any]) => {
                            const pRag = getRag(p.finalScore)
                            return (
                              <div key={pid} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 8px', background: 'white', borderRadius: 'var(--radius)', border: '1px solid rgba(69,85,105,0.1)' }}>
                                <span style={{ fontSize: '13px' }}>{PILLAR_ICONS[pid]}</span>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <div style={{ fontSize: '10px', color: 'var(--sia-medium-gray)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name.split(' ').slice(0,2).join(' ')}</div>
                                </div>
                                <span style={{ fontSize: '12px', fontWeight: 700, color: RAG_COLORS[pRag], minWidth: '24px', textAlign: 'right' }}>
                                  {p.finalScore ? p.finalScore.toFixed(1) : '—'}
                                </span>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
        </div>
      }

      {/* Document status warning */}
      {!hasDocuments && (
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '14px', padding: '16px 20px', background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 'var(--radius-lg)', marginBottom: '20px' }} data-testid="doc-status-warning">
          <FileWarning size={20} color="#D97706" style={{ flexShrink: 0, marginTop: '1px' }} />
          <div>
            <div style={{ fontSize: '14px', fontWeight: 600, color: '#92400E', marginBottom: '4px' }}>No Documents Uploaded</div>
            <p style={{ fontSize: '13px', color: '#92400E', lineHeight: 1.5, margin: 0 }}>
              The assessment agent requires source documents (strategy reports, annual reports, etc.) to analyze. Without documents, the AI will operate in limited mode.{' '}
              <span style={{ textDecoration: 'underline', cursor: 'pointer', fontWeight: 600 }} onClick={() => navigate('/app/setup')}>Upload documents in Project Setup →</span>
            </p>
          </div>
        </div>
      )}

      {hasDocuments && docWarnings.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '14px', padding: '14px 18px', background: '#FFF7ED', border: '1px solid #FDBA74', borderRadius: 'var(--radius-lg)', marginBottom: '20px' }} data-testid="doc-extraction-warning">
          <AlertTriangle size={18} color="#EA580C" style={{ flexShrink: 0, marginTop: '1px' }} />
          <div>
            <div style={{ fontSize: '13px', fontWeight: 600, color: '#9A3412', marginBottom: '3px' }}>{docWarnings.length} document{docWarnings.length > 1 ? 's' : ''} may not have extracted properly</div>
            <p style={{ fontSize: '12px', color: '#9A3412', margin: 0 }}>
              {docWarnings.map((d: any) => d.name).join(', ')} — little or no text was extracted. Try re-uploading or check document format.
            </p>
          </div>
        </div>
      )}

      {/* Run All progress */}
      {runProgress && (
        <div style={{ background: runProgress.errors.length > 0 ? '#FEF2F2' : 'rgba(0,222,204,0.06)', border: `1px solid ${runProgress.errors.length > 0 ? '#FCA5A5' : 'rgba(0,222,204,0.2)'}`, borderRadius: 'var(--radius-lg)', padding: '14px 20px', marginBottom: '24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: runProgress.errors.length > 0 ? '8px' : 0 }}>
            {runningAll ? <Loader2 size={16} color="var(--sia-teal)" className="spinner" /> : runProgress.errors.length > 0 ? <XCircle size={16} color="#DC2626" /> : <CheckCircle size={16} color="var(--sia-green)" />}
            <div style={{ flex: 1 }}>
              <span style={{ fontSize: '13px', fontWeight: 600, color: runningAll ? 'var(--sia-teal)' : runProgress.errors.length > 0 ? '#DC2626' : 'var(--sia-green)' }}>
                {runningAll ? `Running all ${runProgress.total} pillars in parallel — ${runProgress.done} complete` : runProgress.errors.length > 0 ? `Completed with ${runProgress.errors.length} error(s)` : 'All pillars assessed successfully!'}
              </span>
            </div>
          </div>
          {runProgress.errors.length > 0 && (
            <div style={{ marginTop: '8px' }}>
              {runProgress.errors.map((err, i) => (
                <div key={i} style={{ fontSize: '12px', color: '#991B1B', padding: '4px 0' }}>• {err}</div>
              ))}
              <div style={{ fontSize: '11px', color: '#991B1B', marginTop: '6px', opacity: 0.75 }}>
                Use the <strong>Run</strong> button next to each failed pillar in the Pillar Scores list below to retry individually.
              </div>
            </div>
          )}
        </div>
      )}

      {runningPillars.size > 0 && !runProgress && (
        <div style={{ background: 'rgba(0,222,204,0.06)', border: '1px solid rgba(0,222,204,0.2)', borderRadius: 'var(--radius-lg)', padding: '14px 20px', marginBottom: '24px', display: 'flex', alignItems: 'center', gap: '12px' }}>
          <Loader2 size={16} color="var(--sia-teal)" className="spinner" />
          <div>
            <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--sia-teal)' }}>
              {runningPillars.size === 1
                ? `Assessing ${(pillars as any)[Array.from(runningPillars)[0]]?.name}`
                : `Assessing ${runningPillars.size} pillars in parallel`}
            </span>
            {streamLog && <div style={{ fontSize: '11px', color: 'var(--sia-medium-gray)', marginTop: '2px', fontFamily: 'monospace', maxWidth: '600px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{streamLog.substring(0, 120)}...</div>}
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px', marginBottom: '28px' }}>
        {[
          { label: 'Overall Maturity', value: overallScore ? `${overallScore}/5` : '—', sub: overallScore ? RAG_LABELS[getRag(Number(overallScore))] : 'Not assessed', color: overallScore ? RAG_COLORS[getRag(Number(overallScore))] : 'var(--sia-medium-gray)' },
          { label: 'Assessment Progress', value: `${completion}%`, sub: `${Object.values(pillars).filter((p: any) => p.status === 'complete').length}/8 pillars complete`, color: 'var(--sia-teal)' },
          { label: 'Documents Uploaded', value: String(project.documents.length), sub: project.documents.length === 0 ? 'No documents — add in Setup' : `${project.documents.reduce((s: number, d: any) => s + (d.wordCount || 0), 0).toLocaleString()} words extracted`, color: project.documents.length > 0 ? 'var(--sia-navy)' : 'var(--sia-amber)' },
          { label: 'Entities in Portfolio', value: String(1 + entities.length), sub: `${(completion === 100 ? 1 : 0) + entities.filter(e => entityCompletion(e) === 100).length} fully assessed`, color: 'var(--sia-teal)' },
        ].map(stat => (
          <div key={stat.label} className="card" style={{ padding: '20px 24px' }}>
            <div style={{ fontSize: '12px', color: 'var(--sia-medium-gray)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '8px', fontWeight: 500 }}>{stat.label}</div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: '32px', fontWeight: 800, color: stat.color, lineHeight: 1, marginBottom: '6px' }}>{stat.value}</div>
            <div style={{ fontSize: '12px', color: 'var(--sia-medium-gray)' }}>{stat.sub}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginBottom: '20px' }}>
        <div className="card" style={{ padding: '24px' }}>
          <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--sia-navy)', marginBottom: '20px', fontFamily: 'var(--font-display)' }}>8-Pillar Assessment Overview</div>
          {radarData.some(d => d.score > 0) ? (
            <ResponsiveContainer width="100%" height={280}>
              <RadarChart data={radarData}>
                <PolarGrid stroke="rgba(69,85,105,0.15)" />
                <PolarAngleAxis dataKey="subject" tick={{ fill: 'var(--sia-cool-gray)', fontSize: 12, fontFamily: 'var(--font-body)', fontWeight: 600 } as any} />
                <PolarRadiusAxis angle={30} domain={[0, 5]} tick={{ fontSize: 10, fill: 'var(--sia-medium-gray)' } as any} tickCount={6} />
                <Radar name="Score" dataKey="score" stroke="var(--sia-teal)" fill="var(--sia-teal)" fillOpacity={0.2} strokeWidth={2} dot={{ fill: 'var(--sia-teal)', r: 4 } as any} />
                <Tooltip formatter={(v: any) => [`${Number(v).toFixed(1)}/5`, 'Score']} contentStyle={{ background: 'var(--sia-navy)', border: 'none', borderRadius: '8px', color: 'white', fontSize: '13px' }} />
              </RadarChart>
            </ResponsiveContainer>
          ) : (
            <div className="empty-state" style={{ height: '280px' }}>
              <Search size={36} color="rgba(135,150,169,0.3)" />
              <h3>No assessments yet</h3>
              <p style={{ fontSize: '13px' }}>Run assessments to see the radar chart</p>
              <button className="btn btn-primary btn-sm" data-testid="button-start-assessment" onClick={() => navigate('/app/assessment')}>Start Assessment</button>
            </div>
          )}
        </div>

        <div className="card" style={{ padding: '24px' }}>
          <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--sia-navy)', marginBottom: '16px', fontFamily: 'var(--font-display)' }}>Pillar Scores</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {Object.entries(pillars).map(([id, p]: [string, any]) => {
              const rag = getRag(p.finalScore)
              const pct = p.finalScore ? (p.finalScore / 5) * 100 : 0
              return (
                <div key={id} data-testid={`pillar-row-${id}`} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px', borderRadius: 'var(--radius)', background: 'var(--sia-light-gray)', cursor: 'pointer', transition: 'all 0.15s' }}
                  onClick={() => navigate('/app/assessment')}
                  onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = '#E8EBF4'}
                  onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'var(--sia-light-gray)'}
                >
                  <span style={{ fontSize: '16px', width: '20px', flexShrink: 0 }}>{PILLAR_ICONS[id]}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--sia-navy)', marginBottom: '4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</div>
                    <div className="progress-bar" style={{ height: '4px' }}>
                      <div className="progress-fill" style={{ width: `${pct}%`, background: rag === 'red' ? 'var(--sia-red)' : rag === 'amber' ? 'var(--sia-amber)' : rag === 'green' ? 'var(--sia-green)' : 'var(--sia-medium-gray)' }} />
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                    {runningPillars.has(id) ? (
                      <Loader2 size={14} color="var(--sia-teal)" className="spinner" />
                    ) : p.status === 'complete' ? (
                      <CheckCircle size={14} color="var(--sia-green)" />
                    ) : (
                      <button className="btn btn-sm" data-testid={`button-run-${id}`} style={{ padding: '3px 8px', background: 'white', border: '1px solid rgba(0,222,204,0.3)', color: 'var(--sia-teal)', fontSize: '11px', fontWeight: 600 }}
                        onClick={e => { e.stopPropagation(); runSinglePillar(id) }}>
                        Run
                      </button>
                    )}
                    <span style={{ fontFamily: 'var(--font-display)', fontSize: '16px', fontWeight: 700, color: RAG_COLORS[rag], minWidth: '28px', textAlign: 'right' }}>
                      {p.finalScore ? p.finalScore.toFixed(1) : '—'}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
        <div className="card" style={{ padding: '24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
            <AlertTriangle size={16} color="var(--sia-red)" />
            <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--sia-navy)', fontFamily: 'var(--font-display)' }}>Top Strategic Risks</span>
          </div>
          {allThreats.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {allThreats.slice(0, 4).map((t: any, i: number) => (
                <div key={i} style={{ display: 'flex', gap: '10px', padding: '10px', background: '#FEF2F2', borderRadius: 'var(--radius)', border: '1px solid #FECACA' }}>
                  <div style={{ width: '20px', height: '20px', borderRadius: '50%', background: 'var(--sia-red)', color: 'white', fontSize: '11px', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{i+1}</div>
                  <div>
                    <div style={{ fontSize: '13px', color: '#991B1B', lineHeight: 1.4 }}><CitedText text={t.text} onCiteClick={c => { setActiveSourceNum(c.num); setSourcesOpen(true) }} /></div>
                    <div style={{ fontSize: '11px', color: '#B91C1C', marginTop: '3px', opacity: 0.7 }}>from {t.pillar}</div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-state" style={{ padding: '30px 0' }}>
              <p style={{ fontSize: '13px' }}>Run assessments to identify strategic risks</p>
            </div>
          )}
        </div>

        <div className="card" style={{ padding: '24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
            <TrendingUp size={16} color="var(--sia-green)" />
            <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--sia-navy)', fontFamily: 'var(--font-display)' }}>Top Opportunities</span>
          </div>
          {allOpportunities.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {allOpportunities.slice(0, 4).map((o: any, i: number) => (
                <div key={i} style={{ display: 'flex', gap: '10px', padding: '10px', background: '#ECFDF5', borderRadius: 'var(--radius)', border: '1px solid #6EE7B7' }}>
                  <div style={{ width: '20px', height: '20px', borderRadius: '50%', background: 'var(--sia-green)', color: 'white', fontSize: '11px', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{i+1}</div>
                  <div>
                    <div style={{ fontSize: '13px', color: '#065F46', lineHeight: 1.4 }}><CitedText text={o.text} onCiteClick={c => { setActiveSourceNum(c.num); setSourcesOpen(true) }} /></div>
                    <div style={{ fontSize: '11px', color: '#047857', marginTop: '3px', opacity: 0.7 }}>from {o.pillar}</div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-state" style={{ padding: '30px 0' }}>
              <p style={{ fontSize: '13px' }}>Run assessments to identify opportunities</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
