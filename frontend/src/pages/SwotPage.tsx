import React, { useState } from 'react'
import { useStore } from '../store/useStore'
import { aiApi, projectsApi } from '../api'
import { Loader2, RefreshCw, Edit3, Save, X, ChevronDown, ChevronUp, Lightbulb, Building2, BookOpen } from 'lucide-react'
import { CitedText, parseCitations, type Citation } from '../components/CitedText'

const SIGNIFICANCE_COLORS: Record<string, any> = {
  high: { bg: '#FEF2F2', border: '#FECACA', color: '#991B1B', dot: '#EF4444' },
  medium: { bg: '#FFFBEB', border: '#FDE68A', color: '#92400E', dot: '#F59E0B' },
  low: { bg: '#F9FAFB', border: '#E5E7EB', color: '#374151', dot: '#9CA3AF' },
}

export default function SwotPage() {
  const { project, setProject, activeEntityId, sourcesOpen, setSourcesOpen, setActiveSourceNum } = useStore()
  const [consolidating, setConsolidating] = useState(false)
  const [editingHypo, setEditingHypo] = useState(false)
  const [hypoEdit, setHypoEdit] = useState('')
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({ swot: true, hypothesis: true, pillar: false })
  const [expandedPillar, setExpandedPillar] = useState<string | null>(null)
  const [activeFilter, setActiveFilter] = useState('all')

  if (!project) return null

  const activeEntity = activeEntityId ? (project.entities || []).find((e: any) => e.id === activeEntityId) : null
  const activeAssessment = activeEntity ? activeEntity.assessment : project.assessment
  const swot = activeAssessment.consolidatedSwot
  const hypothesis = activeAssessment.strategicHypothesis

  async function handleConsolidate() {
    setConsolidating(true)
    try {
      if (activeEntity) {
        // For entity SWOT, consolidate from entity's own pillar SWOTs
        const entitySwot: Record<string, any[]> = { strengths: [], weaknesses: [], opportunities: [], threats: [] }
        Object.values(activeEntity.assessment.pillars).forEach((p: any) => {
          if (p.swot?.strengths) entitySwot.strengths.push(...p.swot.strengths.map((s: string) => ({ text: s, significance: 'medium', pillar: p.name })))
          if (p.swot?.weaknesses) entitySwot.weaknesses.push(...p.swot.weaknesses.map((s: string) => ({ text: s, significance: 'medium', pillar: p.name })))
          if (p.swot?.opportunities) entitySwot.opportunities.push(...p.swot.opportunities.map((s: string) => ({ text: s, significance: 'medium', pillar: p.name })))
          if (p.swot?.threats) entitySwot.threats.push(...p.swot.threats.map((s: string) => ({ text: s, significance: 'medium', pillar: p.name })))
        })
        const updatedEntities = (project.entities || []).map((e: any) =>
          e.id === activeEntity.id
            ? { ...e, assessment: { ...e.assessment, consolidatedSwot: entitySwot } }
            : e
        )
        await projectsApi.save(project.id, { ...project, entities: updatedEntities })
      } else {
        await aiApi.consolidateSwot(project.id)
      }
      const res = await projectsApi.get(project.id)
      setProject(res.data)
    } catch (e: any) {
      alert('Error: ' + (e.response?.data?.error || e.message))
    }
    setConsolidating(false)
  }

  async function saveHypothesis() {
    if (activeEntity) {
      const updatedEntities = (project.entities || []).map((e: any) =>
        e.id === activeEntity.id
          ? { ...e, assessment: { ...e.assessment, strategicHypothesis: { ...hypothesis, edited: hypoEdit } } }
          : e
      )
      await projectsApi.save(project.id, { ...project, entities: updatedEntities })
    } else {
      await projectsApi.save(project.id, { assessment: { ...project.assessment, strategicHypothesis: { ...hypothesis, edited: hypoEdit } } })
    }
    const res = await projectsApi.get(project.id)
    setProject(res.data)
    setEditingHypo(false)
  }

  const hasConsolidated = swot?.strengths?.length > 0 || swot?.weaknesses?.length > 0

  const swotConfig = [
    { key: 'strengths', label: 'Strengths', icon: '💪', cls: 'swot-strengths', color: '#065F46' },
    { key: 'weaknesses', label: 'Weaknesses', icon: '⚠️', cls: 'swot-weaknesses', color: '#991B1B' },
    { key: 'opportunities', label: 'Opportunities', icon: '🚀', cls: 'swot-opportunities', color: '#1E40AF' },
    { key: 'threats', label: 'Threats', icon: '🛡', cls: 'swot-threats', color: '#92400E' },
  ]

  const filters = ['all', 'high', 'medium', 'low']
  const totalItems = swotConfig.reduce((s: number, q: any) => s + ((swot as any)?.[q.key]?.length || 0), 0)

  const pillarSwotsWithData = Object.entries(activeAssessment.pillars)
    .filter(([, p]: [string, any]) => p.swot?.strengths?.length > 0 || p.swot?.weaknesses?.length > 0)

  // Collect all citation-bearing texts and source maps from pillar SWOTs
  const allSwotTexts: string[] = []
  const allEntitySources: Record<string, any> = {}
  for (const [, p] of Object.entries(activeAssessment.pillars) as [string, any][]) {
    if (p.newSources) Object.assign(allEntitySources, p.newSources)
    for (const key of ['strengths', 'weaknesses', 'opportunities', 'threats']) {
      for (const item of ((p.swot as any)?.[key] || [])) allSwotTexts.push(item)
    }
  }
  // Also include consolidated SWOT texts
  if (swot) {
    for (const key of ['strengths', 'weaknesses', 'opportunities', 'threats']) {
      for (const item of ((swot as any)?.[key] || [])) {
        allSwotTexts.push(typeof item === 'string' ? item : (item.text || ''))
      }
    }
  }
  const { allCitations: allCites } = parseCitations(allSwotTexts.join(' '))

  function handleCiteClick(c: Citation) {
    setActiveSourceNum(c.num)
    setSourcesOpen(true)
  }

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
    <div style={{ flex: 1, overflow: 'auto', padding: '32px', maxWidth: '1200px' }}>
      {/* Entity context banner */}
      {activeEntity && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 14px', background: 'rgba(139,92,246,0.08)', border: '1px solid rgba(139,92,246,0.25)', borderRadius: '8px', marginBottom: '20px' }}>
          <Building2 size={14} color="#8B5CF6" />
          <span style={{ fontSize: '12px', fontWeight: 700, color: '#6D28D9' }}>{activeEntity.name}</span>
          <span style={{ fontSize: '12px', color: '#7C3AED' }}>· Subsidiary Entity — SWOT View</span>
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '28px' }}>
        <div>
          <div style={{ fontSize: '12px', color: 'var(--sia-medium-gray)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '6px', fontWeight: 600 }}>SWOT Analysis</div>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '28px', fontWeight: 800, color: 'var(--sia-navy)' }}>Consolidated Strategic SWOT</h1>
          <div style={{ fontSize: '13px', color: 'var(--sia-cool-gray)', marginTop: '6px' }}>
            {activeEntity ? `${activeEntity.name} · ` : ''}AI-synthesized from all 8 pillar assessments • {totalItems} strategic items identified
          </div>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {allCites.length > 0 && (
            <button className="btn btn-ghost" onClick={() => setSourcesOpen(!sourcesOpen)} title={sourcesOpen ? 'Close sources' : 'Open sources'}
              style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px' }}>
              <BookOpen size={14} />
              Sources
              <span style={{ background: 'var(--sia-navy)', color: 'white', borderRadius: '999px', fontSize: '10px', fontWeight: 700, padding: '1px 6px', minWidth: '18px', textAlign: 'center' }}>
                {Object.keys(allEntitySources).length || allCites.length}
              </span>
            </button>
          )}
          <button className="btn btn-primary" data-testid="button-consolidate-swot" onClick={handleConsolidate} disabled={consolidating}>
            {consolidating ? <><Loader2 size={14} className="spinner" /> Consolidating...</> : <><RefreshCw size={14} /> {hasConsolidated ? 'Re-consolidate' : 'Consolidate SWOT'}</>}
          </button>
        </div>
      </div>

      {!hasConsolidated && (
        <div className="card" style={{ padding: '40px', textAlign: 'center', marginBottom: '24px' }}>
          <div style={{ fontSize: '40px', marginBottom: '16px' }}>🔄</div>
          <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '20px', fontWeight: 700, color: 'var(--sia-navy)', marginBottom: '8px' }}>Ready to Consolidate</h3>
          <p style={{ fontSize: '14px', color: 'var(--sia-cool-gray)', marginBottom: '24px', maxWidth: '500px', margin: '0 auto 24px' }}>
            Once you've run at least a few pillar assessments, click "Consolidate SWOT" to have Claude synthesize and rank all pillar-level findings into a single entity-level SWOT.
          </p>
          <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', flexWrap: 'wrap' }}>
            {swotConfig.map(sq => {
              const pillarItems = Object.values(project.assessment.pillars).reduce((acc: number, p: any) => acc + ((p.swot as any)?.[sq.key]?.length || 0), 0)
              return (
                <div key={sq.key} className={sq.cls} style={{ padding: '12px 20px', borderRadius: 'var(--radius)', border: '1px solid', minWidth: '140px' }}>
                  <div style={{ fontSize: '20px', marginBottom: '4px' }}>{sq.icon}</div>
                  <div style={{ fontSize: '13px', fontWeight: 700, color: sq.color }}>{sq.label}</div>
                  <div style={{ fontSize: '22px', fontWeight: 800, fontFamily: 'var(--font-display)', color: sq.color }}>{pillarItems}</div>
                  <div style={{ fontSize: '11px', color: sq.color, opacity: 0.7 }}>items from pillars</div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {hasConsolidated && (
        <>
          <div style={{ display: 'flex', gap: '8px', marginBottom: '20px', flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ fontSize: '12px', color: 'var(--sia-medium-gray)', fontWeight: 600, marginRight: '4px' }}>Filter by significance:</span>
            {filters.map(f => (
              <button key={f} onClick={() => setActiveFilter(f)}
                style={{ padding: '5px 14px', borderRadius: '999px', border: '1.5px solid', fontSize: '12px', fontWeight: 600, cursor: 'pointer', background: activeFilter === f ? 'var(--sia-navy)' : 'transparent', borderColor: activeFilter === f ? 'var(--sia-navy)' : 'rgba(69,85,105,0.2)', color: activeFilter === f ? 'white' : 'var(--sia-cool-gray)', textTransform: 'capitalize', transition: 'all 0.15s' }}>
                {f}
              </button>
            ))}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '24px' }}>
            {swotConfig.map(sq => {
              const items: any[] = (swot as any)?.[sq.key] || []
              const filtered = activeFilter === 'all' ? items : items.filter((item: any) => (typeof item === 'object' ? item.significance : null) === activeFilter)
              return (
                <div key={sq.key} className={sq.cls} style={{ padding: '20px', borderRadius: 'var(--radius-lg)', border: '1px solid' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
                    <span style={{ fontSize: '18px' }}>{sq.icon}</span>
                    <span style={{ fontSize: '14px', fontWeight: 700, color: sq.color, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{sq.label}</span>
                    <span style={{ marginLeft: 'auto', fontSize: '12px', fontWeight: 700, color: sq.color, background: 'rgba(255,255,255,0.5)', padding: '2px 8px', borderRadius: '999px' }}>{items.length}</span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {filtered.length === 0 ? (
                      <div style={{ fontSize: '13px', color: sq.color, opacity: 0.5, fontStyle: 'italic' }}>No {activeFilter !== 'all' ? activeFilter + ' significance' : ''} items</div>
                    ) : filtered.map((item: any, i: number) => {
                      const text = typeof item === 'string' ? item : item.text
                      const sig = typeof item === 'object' ? item.significance : null
                      const pillar = typeof item === 'object' ? item.sourcePillar : null
                      const sigStyle = sig ? SIGNIFICANCE_COLORS[sig] : null
                      return (
                        <div key={i} style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', padding: '10px 12px', background: 'rgba(255,255,255,0.6)', borderRadius: 'var(--radius)', border: '1px solid rgba(255,255,255,0.8)' }}>
                          {sigStyle && <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: sigStyle.dot, flexShrink: 0, marginTop: '5px' }} />}
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: '13px', color: sq.color, lineHeight: 1.5 }}><CitedText text={text} onCiteClick={handleCiteClick} /></div>
                            {(sig || pillar) && (
                              <div style={{ display: 'flex', gap: '6px', marginTop: '5px' }}>
                                {sig && <span style={{ fontSize: '10px', fontWeight: 600, textTransform: 'uppercase', color: sigStyle?.color, padding: '1px 6px', borderRadius: '999px', background: sigStyle?.bg, border: `1px solid ${sigStyle?.border}` }}>{sig}</span>}
                                {pillar && <span style={{ fontSize: '10px', color: sq.color, opacity: 0.6 }}>{pillar}</span>}
                              </div>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}

      <div className="card" style={{ marginBottom: '16px', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', cursor: 'pointer', borderBottom: expandedSections.hypothesis ? '1px solid rgba(69,85,105,0.08)' : 'none' }}
          onClick={() => setExpandedSections(s => ({ ...s, hypothesis: !s.hypothesis }))}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Lightbulb size={16} color="var(--sia-teal)" />
            <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--sia-navy)', fontFamily: 'var(--font-display)' }}>Strategic Hypothesis</span>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            {hypothesis?.edited && !editingHypo && (
              <button className="btn btn-ghost btn-sm" data-testid="button-edit-hypothesis" onClick={e => { e.stopPropagation(); setHypoEdit(hypothesis.edited); setEditingHypo(true); setExpandedSections(s => ({...s, hypothesis: true})) }}>
                <Edit3 size={12} /> Edit
              </button>
            )}
            {expandedSections.hypothesis ? <ChevronUp size={16} color="var(--sia-medium-gray)" /> : <ChevronDown size={16} color="var(--sia-medium-gray)" />}
          </div>
        </div>
        {expandedSections.hypothesis && (
          <div style={{ padding: '20px' }}>
            {editingHypo ? (
              <div>
                <textarea className="form-input" value={hypoEdit} onChange={e => setHypoEdit(e.target.value)} style={{ minHeight: '200px', marginBottom: '12px', width: '100%' }} />
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button className="btn btn-primary btn-sm" data-testid="button-save-hypothesis" onClick={saveHypothesis}><Save size={12} /> Save</button>
                  <button className="btn btn-ghost btn-sm" onClick={() => setEditingHypo(false)}><X size={12} /> Cancel</button>
                  <button className="btn btn-ghost btn-sm" onClick={() => setHypoEdit(hypothesis?.aiDraft || '')}>Restore AI Draft</button>
                </div>
              </div>
            ) : hypothesis?.edited ? (
              <p style={{ fontSize: '14px', color: 'var(--sia-cool-gray)', lineHeight: 1.8, whiteSpace: 'pre-wrap' }}>{hypothesis.edited}</p>
            ) : (
              <div className="empty-state" style={{ padding: '30px 0' }}>
                <p style={{ fontSize: '13px' }}>Run SWOT consolidation to generate strategic hypothesis</p>
              </div>
            )}
          </div>
        )}
      </div>

      {pillarSwotsWithData.length > 0 && (
        <div className="card" style={{ overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', cursor: 'pointer', borderBottom: expandedSections.pillar ? '1px solid rgba(69,85,105,0.08)' : 'none' }}
            onClick={() => setExpandedSections(s => ({ ...s, pillar: !s.pillar }))}>
            <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--sia-navy)', fontFamily: 'var(--font-display)' }}>Pillar-Level SWOTs ({pillarSwotsWithData.length} pillars assessed)</span>
            {expandedSections.pillar ? <ChevronUp size={16} color="var(--sia-medium-gray)" /> : <ChevronDown size={16} color="var(--sia-medium-gray)" />}
          </div>
          {expandedSections.pillar && (
            <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {pillarSwotsWithData.map(([id, p]: [string, any]) => (
                <div key={id} style={{ border: '1px solid rgba(69,85,105,0.1)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 16px', background: expandedPillar === id ? 'var(--sia-light-gray)' : 'white', cursor: 'pointer' }}
                    onClick={() => setExpandedPillar(expandedPillar === id ? null : id)}>
                    <span style={{ fontSize: '14px' }}>{['🎯','🏛','💰','🗺','⚙️','👥','🛡','🚀'][parseInt(id.slice(1)) - 1]}</span>
                    <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--sia-navy)' }}>{p.name}</span>
                    <span style={{ marginLeft: 'auto', fontSize: '12px', color: 'var(--sia-medium-gray)' }}>
                      {['strengths','weaknesses','opportunities','threats'].reduce((s: number, k: string) => s + ((p.swot as any)?.[k]?.length || 0), 0)} items
                    </span>
                    {expandedPillar === id ? <ChevronUp size={14} color="var(--sia-medium-gray)" /> : <ChevronDown size={14} color="var(--sia-medium-gray)" />}
                  </div>
                  {expandedPillar === id && (
                    <div style={{ padding: '14px 16px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', borderTop: '1px solid rgba(69,85,105,0.08)' }}>
                      {swotConfig.map(sq => (
                        <div key={sq.key} className={sq.cls} style={{ padding: '10px', borderRadius: '6px', border: '1px solid' }}>
                          <div style={{ fontSize: '11px', fontWeight: 700, color: sq.color, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '6px' }}>{sq.label}</div>
                          {((p.swot as any)?.[sq.key] || []).length > 0 ? (
                            <ul style={{ paddingLeft: '14px', display: 'flex', flexDirection: 'column', gap: '3px' }}>
                              {(p.swot as any)[sq.key].map((item: string, i: number) => (
                                <li key={i} style={{ fontSize: '11px', color: sq.color, lineHeight: 1.4 }}><CitedText text={item} onCiteClick={handleCiteClick} /></li>
                              ))}
                            </ul>
                          ) : <div style={{ fontSize: '11px', color: sq.color, opacity: 0.4 }}>None</div>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  </div>
  )
}
