import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore'
import { RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer, Tooltip } from 'recharts'
import { Search, Play, AlertTriangle, TrendingUp, FileText, Loader2, CheckCircle, XCircle, FileWarning } from 'lucide-react'
import { aiApi, projectsApi } from '../api'

const PILLAR_ICONS: Record<string, string> = { P1:'🎯', P2:'🏛', P3:'💰', P4:'🗺', P5:'⚙️', P6:'👥', P7:'🛡', P8:'🚀' }
const RAG_COLORS: Record<string, string> = { red: 'var(--sia-red)', amber: 'var(--sia-amber)', green: 'var(--sia-green)', gray: 'var(--sia-medium-gray)' }
const RAG_LABELS: Record<string, string> = { red: 'Critical', amber: 'Developing', green: 'Strong', gray: 'Not Assessed' }

export default function Dashboard() {
  const navigate = useNavigate()
  const { project, setProject, getOverallScore, getCompletionPercent, getRag } = useStore()
  const [runningAll, setRunningAll] = useState(false)
  const [runningPillars, setRunningPillars] = useState<Set<string>>(new Set())
  const [runProgress, setRunProgress] = useState<{ done: number; total: number; errors: string[] } | null>(null)
  const [streamLog, setStreamLog] = useState('')

  if (!project) return null

  const pillars = project.assessment.pillars
  const overallScore = getOverallScore()
  const completion = getCompletionPercent()

  const radarData = Object.entries(pillars).map(([id, p]: [string, any]) => ({
    subject: id,
    score: p.finalScore || 0,
    fullMark: 5
  }))

  const hasDocuments = project.documents && project.documents.length > 0
  const docWarnings = project.documents ? project.documents.filter((d: any) => !d.extractedText || d.extractedText.length < 100) : []

  async function runSinglePillar(pillarId: string) {
    if (!hasDocuments) {
      alert('Please upload at least one document in Project Setup before running an assessment.')
      return
    }
    setRunningPillars(prev => new Set(prev).add(pillarId))
    setStreamLog('')
    try {
      for await (const data of aiApi.assessPillarStream(project.id, pillarId)) {
        if (data.chunk) setStreamLog((prev: string) => prev + data.chunk)
        if (data.done) {
          const res = await projectsApi.get(project.id)
          setProject(res.data)
          setStreamLog('')
        }
        if (data.error) { alert('Pillar assessment error: ' + data.error); break }
      }
    } catch (e: any) {
      alert('Error running assessment: ' + e.message)
    } finally {
      setRunningPillars(prev => { const next = new Set(prev); next.delete(pillarId); return next })
    }
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

    try {
      // Fire all pillar assessments in parallel via the batch endpoint
      for await (const data of aiApi.assessBatchStream(project.id, pillarIds)) {
        if (data.pillarId && data.progress) {
          doneCount++
          setRunningPillars(prev => { const next = new Set(prev); next.delete(data.pillarId); return next })
          setRunProgress({ done: doneCount, total: pillarIds.length, errors: [...errors] })
        }
        if (data.pillarId && data.error) {
          doneCount++
          errors.push(`${data.pillarId}: ${data.error}`)
          setRunningPillars(prev => { const next = new Set(prev); next.delete(data.pillarId); return next })
          setRunProgress({ done: doneCount, total: pillarIds.length, errors: [...errors] })
        }
        if (data.done) {
          const res = await projectsApi.get(project.id)
          setProject(res.data)
        }
        if (data.error && !data.pillarId) {
          errors.push(data.error)
        }
      }
    } catch (e: any) {
      errors.push(e.message)
    }

    setRunningPillars(new Set())
    setRunningAll(false)
    setStreamLog('')
    if (errors.length > 0) {
      setRunProgress({ done: pillarIds.length, total: pillarIds.length, errors })
    } else {
      setTimeout(() => setRunProgress(null), 4000)
    }
  }

  const allThreats = Object.values(pillars).flatMap((p: any) => (p.swot?.threats || []).map((t: string) => ({ text: t, pillar: p.name })))
  const allOpportunities = Object.values(pillars).flatMap((p: any) => (p.swot?.opportunities || []).map((o: string) => ({ text: o, pillar: p.name })))

  return (
    <div style={{ padding: '32px', maxWidth: '1400px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '32px' }}>
        <div>
          <div style={{ fontSize: '12px', color: 'var(--sia-medium-gray)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '6px', fontWeight: 600 }}>Assessment Dashboard</div>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '32px', fontWeight: 800, color: 'var(--sia-navy)', marginBottom: '4px' }}>{project.entityName}</h1>
          <div style={{ fontSize: '14px', color: 'var(--sia-cool-gray)' }}>{project.name} {project.consultantName && `• ${project.consultantName}`}</div>
        </div>
        <div style={{ display: 'flex', gap: '10px' }}>
          <button className="btn btn-ghost" data-testid="button-manage-docs" onClick={() => navigate('/app/setup')}>
            <FileText size={14} /> Manage Documents
          </button>
          <button className="btn btn-primary" data-testid="button-run-all" onClick={runAllPillars} disabled={runningAll}>
            {runningAll ? <><Loader2 size={14} className="spinner" /> Running All...</> : <><Play size={14} /> Run All Assessments</>}
          </button>
        </div>
      </div>

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
          { label: 'Overall Maturity', value: overallScore ? `${overallScore}/5` : '—', sub: overallScore ? RAG_LABELS[getRag(parseFloat(overallScore))] : 'Not assessed', color: overallScore ? RAG_COLORS[getRag(parseFloat(overallScore))] : 'var(--sia-medium-gray)' },
          { label: 'Assessment Progress', value: `${completion}%`, sub: `${Object.values(pillars).filter((p: any) => p.status === 'complete').length}/8 pillars complete`, color: 'var(--sia-teal)' },
          { label: 'Documents Uploaded', value: String(project.documents.length), sub: project.documents.length === 0 ? 'No documents — add in Setup' : `${project.documents.reduce((s: number, d: any) => s + (d.wordCount || 0), 0).toLocaleString()} words extracted`, color: project.documents.length > 0 ? 'var(--sia-navy)' : 'var(--sia-amber)' },
          { label: 'Data Gaps Identified', value: String(Object.values(pillars).reduce((s: number, p: any) => s + (p.elements || []).filter((e: any) => e.dataGap).length, 0)), sub: 'Click Assessment to review', color: 'var(--sia-cool-gray)' },
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
                    <div style={{ fontSize: '13px', color: '#991B1B', lineHeight: 1.4 }}>{t.text}</div>
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
                    <div style={{ fontSize: '13px', color: '#065F46', lineHeight: 1.4 }}>{o.text}</div>
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
