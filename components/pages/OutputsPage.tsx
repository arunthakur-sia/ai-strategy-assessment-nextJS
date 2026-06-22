'use client'
import React, { useState, useEffect } from 'react'
import { useStore } from '@/store/useStore'
import { aiApi, projectsApi } from '@/lib/api'
import {
  Loader2, CheckCircle, RefreshCw, FileText, BookOpen, Layers, Zap,
} from 'lucide-react'
import MarkdownReportPanel from '@/components/MarkdownReportPanel'

const REPORTS = [
  { id: 'D1', title: 'D1 — Strategic Perception & Hypothesis Report', desc: 'Initial strategic hypothesis, patterns, tensions, and diagnostic focus areas.', icon: '🔍', color: '#3B82F6', bg: '#EFF6FF', border: '#BFDBFE' },
  { id: 'D2', title: 'D2 — Strategic Diagnostic Report with SWOT', desc: 'Comprehensive diagnostic with all pillar scores, consolidated SWOT, and strategic priorities.', icon: '📊', color: '#8B5CF6', bg: '#F5F3FF', border: '#DDD6FE' },
  { id: 'D3', title: 'D3 — Benchmark & Opportunity Map', desc: 'Cross-entity pillar comparison, internal benchmarking, external GCC benchmarks, and 2×2 opportunity matrix.', icon: '🌍', color: '#059669', bg: '#ECFDF5', border: '#6EE7B7' },
  { id: 'D4', title: 'D4 — AI Video Script', desc: '3–5 minute script with [SCENE], [NARRATOR], [VISUAL CUE] blocks covering findings and imperatives.', icon: '🎬', color: '#F59E0B', bg: '#FFFBEB', border: '#FDE68A' },
  { id: 'D5', title: 'D5 — Stakeholder Interview Questions', desc: 'Leadership, team lead, and gap-filling question sets — tagged by pillar and priority.', icon: '🎤', color: '#10B981', bg: '#ECFDF5', border: '#6EE7B7' },
  { id: 'D6', title: 'D6 — Full Strategy Document', desc: 'Complete strategy: Vision → Objectives → KPIs → Initiatives → Projects with executive summary.', icon: '📋', color: '#EC4899', bg: '#FDF2F8', border: '#FBCFE8' },
]

type BatchStatus = 'idle' | 'started' | 'done' | 'error'

function defaultOutputs() {
  return { D1: null, D2: null, D3: null, D4: null, D5: null, D6: null }
}

export default function OutputsPage() {
  const { project, setProject, activeEntityId } = useStore()

  // Batch selection — initialize with the sidebar's active entity
  const [selectedEntityIds, setSelectedEntityIds] = useState<Set<string>>(() =>
    new Set([activeEntityId || '__main__'])
  )
  const [selectedReportTypes, setSelectedReportTypes] = useState<Set<string>>(new Set(['D1', 'D2', 'D3']))

  // Batch state
  const [batchInProgress, setBatchInProgress] = useState(false)
  const [batchProgress, setBatchProgress] = useState<Record<string, Record<string, BatchStatus>>>({})
  const [batchSummary, setBatchSummary] = useState<{ total: number; succeeded: number; failed: number } | null>(null)

  // Entity tab being viewed — keep in sync with sidebar entity switcher
  const [activeEntityTab, setActiveEntityTab] = useState<string>(
    activeEntityId || '__main__'
  )

  // When the sidebar entity changes, update the active tab and selection
  useEffect(() => {
    const tabId = activeEntityId || '__main__'
    setActiveEntityTab(tabId)
    setSelectedEntityIds(new Set([tabId]))
  }, [activeEntityId])

  // Single-report generation (from the cards below)
  const [generating, setGenerating] = useState<string | null>(null)
  const [progressMsg, setProgressMsg] = useState<string>('')

  // Report viewer modal
  const [viewingReport, setViewingReport] = useState<{ entityId: string; reportType: string } | null>(null)

  if (!project) return null

  const entities: any[] = project.entities || []
  const hasEntities = entities.length > 0

  const allEntityOptions = [
    { id: '__main__', name: project.entityName, type: project.entityType },
    ...entities.map((e: any) => ({ id: e.id, name: e.name, type: e.type })),
  ]

  function getEntityOutputs(entityId: string): Record<string, any> {
    if (entityId === '__main__') return project!.outputs || {}
    const entity = entities.find((e: any) => e.id === entityId)
    return entity?.outputs || {}
  }

  function getEntityAssessment(entityId: string) {
    if (entityId === '__main__') return project!.assessment
    const entity = entities.find((e: any) => e.id === entityId)
    return entity?.assessment || project!.assessment
  }

  // ── Toggle helpers ────────────────────────────────────────────
  function toggleEntityId(id: string) {
    setSelectedEntityIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }
  function toggleReportType(id: string) {
    setSelectedReportTypes(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }
  function selectAllEntities() {
    setSelectedEntityIds(new Set(allEntityOptions.map(e => e.id)))
  }
  function selectAllReports() {
    setSelectedReportTypes(new Set(REPORTS.map(r => r.id)))
  }

  // ── Batch generation ──────────────────────────────────────────
  async function startBatchGeneration() {
    if (selectedEntityIds.size === 0 || selectedReportTypes.size === 0) return
    setBatchInProgress(true)
    setBatchSummary(null)

    const initProgress: Record<string, Record<string, BatchStatus>> = {}
    for (const eid of selectedEntityIds) {
      initProgress[eid] = {}
      for (const rt of selectedReportTypes) initProgress[eid][rt] = 'idle'
    }
    setBatchProgress(initProgress)

    try {
      for await (const event of aiApi.generateReportsBatch(
        project!.id,
        Array.from(selectedEntityIds),
        Array.from(selectedReportTypes),
      )) {
        if (event.error) { console.error('Batch error:', event.error); break }
        if (event.batchDone) {
          setBatchSummary({ total: event.total, succeeded: event.succeeded, failed: event.failed })
          const updated = await projectsApi.get(project!.id)
          setProject(updated.data)
          break
        }
        if (event.entityId && event.reportType && event.status) {
          setBatchProgress(prev => ({
            ...prev,
            [event.entityId]: { ...(prev[event.entityId] || {}), [event.reportType]: event.status as BatchStatus },
          }))
        }
      }
    } catch (e: any) {
      console.error('Batch generation failed:', e)
    }
    setBatchInProgress(false)
  }

  // ── Single report generate (from entity tab card) ─────────────
  async function generateSingleReport(reportId: string) {
    setGenerating(reportId)
    setProgressMsg('Starting…')
    const entityId = activeEntityTab === '__main__' ? undefined : activeEntityTab
    try {
      for await (const event of aiApi.generateReport(project!.id, reportId, entityId)) {
        if (event.error) throw new Error(event.error)
        if (event.progress && event.message) setProgressMsg(event.message)
        if (event.done) break
      }
      const updated = await projectsApi.get(project!.id)
      setProject(updated.data)
    } catch (e: any) {
      alert('Generation failed: ' + (e.message || 'Unknown error'))
    }
    setProgressMsg('')
    setGenerating(null)
  }

  // ── Save edited content ───────────────────────────────────────
  async function saveEditedContent(entityId: string, reportId: string, newContent: string) {
    let updatedProject = { ...project! }
    if (entityId === '__main__') {
      updatedProject = {
        ...updatedProject,
        outputs: { ...updatedProject.outputs, [reportId]: { ...(updatedProject.outputs[reportId] || {}), content: newContent } },
      }
    } else {
      updatedProject = {
        ...updatedProject,
        entities: updatedProject.entities.map((e: any) =>
          e.id !== entityId ? e : {
            ...e,
            outputs: { ...(e.outputs || {}), [reportId]: { ...(e.outputs?.[reportId] || {}), content: newContent } },
          }
        ),
      }
    }
    setProject(updatedProject)
    try { await projectsApi.save(project!.id, updatedProject) } catch { /* non-critical */ }
  }

  // ── Derived state for current tab ─────────────────────────────
  const tabAssessment = getEntityAssessment(activeEntityTab)
  const tabOutputs = getEntityOutputs(activeEntityTab)
  const assessedCount = Object.values(tabAssessment?.pillars || {}).filter((p: any) => p.status === 'complete').length
  const overallScore = Object.values(tabAssessment?.pillars || {})
    .filter((p: any) => p.finalScore)
    .reduce((s: number, p: any, _: any, arr: any[]) => s + p.finalScore / arr.length, 0) || 0
  const hasSwot = (tabAssessment?.consolidatedSwot?.strengths?.length || 0) > 0

  const viewingReportData = viewingReport ? REPORTS.find(r => r.id === viewingReport.reportType) : null
  const viewingOutput = viewingReport ? getEntityOutputs(viewingReport.entityId)[viewingReport.reportType] : null

  // Count of batch jobs done
  const batchDoneCount = Object.values(batchProgress).flatMap(Object.values).filter(s => s === 'done').length
  const batchErrorCount = Object.values(batchProgress).flatMap(Object.values).filter(s => s === 'error').length
  const batchTotalJobs = Object.values(batchProgress).flatMap(Object.values).length

  return (
    <div style={{ padding: '32px', maxWidth: '1060px' }}>

      {/* ── Page header ─────────────────────────────────────── */}
      <div style={{ marginBottom: '28px' }}>
        <div style={{ fontSize: '12px', color: 'var(--sia-medium-gray)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '6px', fontWeight: 600 }}>Deliverables</div>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '28px', fontWeight: 800, color: 'var(--sia-navy)' }}>Assessment Reports</h1>
        <div style={{ fontSize: '13px', color: 'var(--sia-cool-gray)', marginTop: '6px' }}>
          Generate AI-powered consulting reports — rendered as markdown, editable and copyable — D1 through D6
        </div>
      </div>

      {/* ── Batch Generation Panel (multi-entity) ───────────── */}
      <div className="card" style={{ padding: '24px', marginBottom: '24px', border: '2px solid #E2E8F0' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px' }}>
          <Layers size={18} color="var(--sia-navy)" />
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '16px', fontWeight: 700, color: 'var(--sia-navy)', margin: 0 }}>
            Batch Deliverable Generation
          </h2>
          <span style={{ fontSize: '12px', color: 'var(--sia-medium-gray)', marginLeft: '4px' }}>
            — generate reports for multiple entities in parallel
          </span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: hasEntities ? '1fr 1fr' : '1fr', gap: '24px', marginBottom: '20px' }}>
          {/* Entity selection */}
          {hasEntities && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
                <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--sia-navy)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  Entities ({selectedEntityIds.size}/{allEntityOptions.length} selected)
                </div>
                <button
                  className="btn btn-ghost btn-sm"
                  style={{ fontSize: '11px', padding: '2px 8px' }}
                  onClick={() =>
                    selectedEntityIds.size === allEntityOptions.length
                      ? setSelectedEntityIds(new Set())
                      : selectAllEntities()
                  }
                >
                  {selectedEntityIds.size === allEntityOptions.length ? 'Deselect all' : 'Select all'}
                </button>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {allEntityOptions.map(opt => (
                  <label key={opt.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', padding: '7px 10px', borderRadius: '6px', border: `1px solid ${selectedEntityIds.has(opt.id) ? 'var(--sia-navy)' : '#E2E8F0'}`, background: selectedEntityIds.has(opt.id) ? '#EFF6FF' : 'white', transition: 'all 0.15s' }}>
                    <input
                      type="checkbox"
                      checked={selectedEntityIds.has(opt.id)}
                      onChange={() => toggleEntityId(opt.id)}
                      style={{ accentColor: 'var(--sia-navy)', width: '14px', height: '14px' }}
                    />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--sia-navy)' }}>{opt.name}</div>
                      <div style={{ fontSize: '11px', color: 'var(--sia-medium-gray)' }}>{opt.id === '__main__' ? 'Main entity' : opt.type}</div>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* Report type selection */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
              <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--sia-navy)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                Deliverables ({selectedReportTypes.size}/6 selected)
              </div>
              <button
                className="btn btn-ghost btn-sm"
                style={{ fontSize: '11px', padding: '2px 8px' }}
                onClick={() =>
                  selectedReportTypes.size === REPORTS.length
                    ? setSelectedReportTypes(new Set())
                    : selectAllReports()
                }
              >
                {selectedReportTypes.size === REPORTS.length ? 'Deselect all' : 'Select all'}
              </button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {REPORTS.map(r => (
                <label key={r.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', padding: '7px 10px', borderRadius: '6px', border: `1px solid ${selectedReportTypes.has(r.id) ? r.color : '#E2E8F0'}`, background: selectedReportTypes.has(r.id) ? r.bg : 'white', transition: 'all 0.15s' }}>
                  <input
                    type="checkbox"
                    checked={selectedReportTypes.has(r.id)}
                    onChange={() => toggleReportType(r.id)}
                    style={{ accentColor: r.color, width: '14px', height: '14px' }}
                  />
                  <span style={{ fontSize: '16px' }}>{r.icon}</span>
                  <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--sia-navy)' }}>{r.id}</span>
                  <span style={{ fontSize: '12px', color: 'var(--sia-cool-gray)' }}>{r.title.split(' — ')[1] || ''}</span>
                </label>
              ))}
            </div>
          </div>
        </div>

        {/* Generate button + summary */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', paddingTop: '16px', borderTop: '1px solid #F1F5F9' }}>
          <button
            className="btn btn-primary"
            onClick={startBatchGeneration}
            disabled={batchInProgress || selectedEntityIds.size === 0 || selectedReportTypes.size === 0}
            style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
          >
            {batchInProgress
              ? <><Loader2 size={14} className="spinner" /> Generating…</>
              : <><Zap size={14} /> Generate {selectedReportTypes.size} report{selectedReportTypes.size !== 1 ? 's' : ''}{hasEntities ? ` × ${selectedEntityIds.size} entit${selectedEntityIds.size !== 1 ? 'ies' : 'y'}` : ''}</>}
          </button>
          {batchInProgress && batchTotalJobs > 0 && (
            <span style={{ fontSize: '13px', color: 'var(--sia-cool-gray)' }}>
              {batchDoneCount + batchErrorCount}/{batchTotalJobs} complete
              {batchErrorCount > 0 && <span style={{ color: '#EF4444', marginLeft: '6px' }}>{batchErrorCount} failed</span>}
            </span>
          )}
          {batchSummary && !batchInProgress && (
            <span style={{ fontSize: '13px', color: batchSummary.failed > 0 ? '#D97706' : 'var(--sia-green)', fontWeight: 600 }}>
              ✓ {batchSummary.succeeded}/{batchSummary.total} reports generated
              {batchSummary.failed > 0 && ` (${batchSummary.failed} failed)`}
            </span>
          )}
        </div>
      </div>

      {/* ── Batch Progress Matrix ─────────────────────────────── */}
      {(batchInProgress || (batchSummary && Object.keys(batchProgress).length > 0)) && (
        <div className="card" style={{ padding: '20px', marginBottom: '24px', overflowX: 'auto' }}>
          <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--sia-navy)', marginBottom: '14px' }}>
            Generation Progress
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: '6px 12px', color: 'var(--sia-medium-gray)', fontWeight: 600, borderBottom: '1px solid #F1F5F9' }}>Entity</th>
                {Array.from(selectedReportTypes).map(rt => (
                  <th key={rt} style={{ textAlign: 'center', padding: '6px 12px', color: 'var(--sia-medium-gray)', fontWeight: 600, borderBottom: '1px solid #F1F5F9' }}>{rt}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from(selectedEntityIds).map(eid => {
                const name = allEntityOptions.find(o => o.id === eid)?.name || eid
                return (
                  <tr key={eid} style={{ borderBottom: '1px solid #F8FAFC' }}>
                    <td style={{ padding: '8px 12px', fontWeight: 500, color: 'var(--sia-navy)', whiteSpace: 'nowrap' }}>{name}</td>
                    {Array.from(selectedReportTypes).map(rt => {
                      const status: BatchStatus = batchProgress[eid]?.[rt] || 'idle'
                      return (
                        <td key={rt} style={{ textAlign: 'center', padding: '8px 12px' }}>
                          {status === 'idle' && <span style={{ color: '#CBD5E1', fontSize: '14px' }}>—</span>}
                          {status === 'started' && <Loader2 size={14} className="spinner" color="#3B82F6" />}
                          {status === 'done' && <CheckCircle size={14} color="#10B981" />}
                          {status === 'error' && <span style={{ color: '#EF4444', fontWeight: 700 }}>✕</span>}
                        </td>
                      )
                    })}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Entity Tab Bar ────────────────────────────────────── */}
      {hasEntities && (
        <div style={{ display: 'flex', gap: '4px', marginBottom: '20px', borderBottom: '2px solid #E2E8F0', paddingBottom: '0' }}>
          {allEntityOptions.map(opt => (
            <button
              key={opt.id}
              onClick={() => setActiveEntityTab(opt.id)}
              style={{
                padding: '8px 16px',
                fontSize: '13px',
                fontWeight: activeEntityTab === opt.id ? 700 : 500,
                color: activeEntityTab === opt.id ? 'var(--sia-navy)' : 'var(--sia-medium-gray)',
                background: 'none',
                border: 'none',
                borderBottom: activeEntityTab === opt.id ? '2px solid var(--sia-navy)' : '2px solid transparent',
                cursor: 'pointer',
                marginBottom: '-2px',
                whiteSpace: 'nowrap',
              }}
            >
              {opt.name}
              {opt.id === '__main__' && <span style={{ fontSize: '10px', marginLeft: '4px', color: 'var(--sia-medium-gray)' }}>(main)</span>}
            </button>
          ))}
        </div>
      )}

      {/* ── Readiness stats for active tab ───────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px', marginBottom: '20px' }}>
        {[
          { label: 'Pillars Assessed', value: `${assessedCount}/8`, ok: assessedCount >= 4 },
          { label: 'SWOT Consolidated', value: hasSwot ? 'Yes ✓' : 'No', ok: hasSwot },
          { label: 'Overall Maturity Score', value: overallScore > 0 ? `${overallScore.toFixed(1)}/5` : '—', ok: overallScore > 0 },
        ].map(stat => (
          <div key={stat.label} className="card" style={{ padding: '14px 18px', display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{ width: '30px', height: '30px', borderRadius: '50%', background: stat.ok ? '#ECFDF5' : '#FFFBEB', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              {stat.ok ? <CheckCircle size={14} color="#10B981" /> : <FileText size={14} color="#F59E0B" />}
            </div>
            <div>
              <div style={{ fontSize: '11px', color: 'var(--sia-medium-gray)', textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: 500 }}>{stat.label}</div>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: '17px', fontWeight: 700, color: stat.ok ? 'var(--sia-green)' : 'var(--sia-amber)' }}>{stat.value}</div>
            </div>
          </div>
        ))}
      </div>

      {assessedCount === 0 && (
        <div className="card" style={{ padding: '24px', background: '#FFFBEB', border: '1px solid #FDE68A', marginBottom: '20px', display: 'flex', alignItems: 'flex-start', gap: '14px' }}>
          <span style={{ fontSize: '22px' }}>⚠️</span>
          <div>
            <div style={{ fontSize: '14px', fontWeight: 600, color: '#92400E', marginBottom: '4px' }}>No Pillar Assessments Completed{hasEntities ? ` for ${allEntityOptions.find(o => o.id === activeEntityTab)?.name}` : ''}</div>
            <p style={{ fontSize: '13px', color: '#92400E', lineHeight: 1.6 }}>Complete at least 1–2 pillar assessments before generating reports.</p>
          </div>
        </div>
      )}

      {/* ── Report cards for active tab ───────────────────────── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        {REPORTS.map(report => {
          const output = tabOutputs[report.id]
          const isGenerated = output?.generated && output?.content
          const isGenerating = generating === report.id

          return (
            <div key={report.id} className="card" style={{ overflow: 'hidden' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '16px', padding: '20px 24px' }}>
                <div style={{ width: '48px', height: '48px', borderRadius: 'var(--radius-lg)', background: report.bg, border: `1px solid ${report.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '22px', flexShrink: 0 }}>
                  {report.icon}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '4px' }}>
                    <div>
                      <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '15px', fontWeight: 700, color: 'var(--sia-navy)', marginBottom: '3px' }}>{report.title}</h3>
                      <p style={{ fontSize: '12px', color: 'var(--sia-cool-gray)', lineHeight: 1.5 }}>{report.desc}</p>
                    </div>
                    {isGenerated && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0, marginLeft: '16px' }}>
                        <CheckCircle size={13} color="var(--sia-green)" />
                        <span style={{ fontSize: '11px', color: 'var(--sia-green)', fontWeight: 600 }}>Ready</span>
                      </div>
                    )}
                  </div>

                  {isGenerated && output.lastGenerated && (
                    <div style={{ fontSize: '11px', color: 'var(--sia-medium-gray)', marginBottom: '10px' }}>
                      Generated: {new Date(output.lastGenerated).toLocaleString()}
                    </div>
                  )}

                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '8px' }}>
                    <button
                      className="btn btn-primary btn-sm"
                      data-testid={`button-generate-${report.id}`}
                      onClick={() => generateSingleReport(report.id)}
                      disabled={isGenerating || batchInProgress}
                    >
                      {isGenerating
                        ? <><Loader2 size={13} className="spinner" /> {progressMsg || 'Generating…'}</>
                        : isGenerated
                          ? <><RefreshCw size={13} /> Regenerate</>
                          : <><span>✨</span> Generate {report.id}</>}
                    </button>

                    {isGenerated && (
                      <button
                        className="btn btn-secondary btn-sm"
                        data-testid={`button-view-${report.id}`}
                        onClick={() => setViewingReport({ entityId: activeEntityTab, reportType: report.id })}
                        style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                      >
                        <BookOpen size={13} /> View Report
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* ── Markdown Report Viewer Modal ─────────────────────── */}
      {viewingReport && viewingReportData && viewingOutput?.content && (
        <MarkdownReportPanel
          reportId={viewingReport.reportType}
          reportTitle={viewingReportData.title}
          content={viewingOutput.content}
          lastGenerated={viewingOutput.lastGenerated}
          onSave={(newContent) => saveEditedContent(viewingReport.entityId, viewingReport.reportType, newContent)}
          onClose={() => setViewingReport(null)}
        />
      )}
    </div>
  )
}
