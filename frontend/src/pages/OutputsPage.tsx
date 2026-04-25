import React, { useState } from 'react'
import { useStore } from '../store/useStore'
import { aiApi, projectsApi } from '../api'
import { Download, Loader2, CheckCircle, RefreshCw, Eye, X, FileText, Copy } from 'lucide-react'
import axios from 'axios'

const REPORTS = [
  {
    id: 'D1',
    title: 'D1 — Strategic Perception & Hypothesis Report',
    desc: 'Initial strategic hypothesis, patterns, tensions, and diagnostic focus areas based on the document review phase.',
    icon: '🔍',
    color: '#3B82F6',
    bg: '#EFF6FF',
    border: '#BFDBFE',
    formats: ['PDF', 'DOCX'],
  },
  {
    id: 'D2',
    title: 'D2 — Strategic Diagnostic Report with SWOT',
    desc: 'Comprehensive diagnostic report with all pillar scores, evidence, consolidated SWOT, and strategic priorities. Bullet-point format throughout.',
    icon: '📊',
    color: '#8B5CF6',
    bg: '#F5F3FF',
    border: '#DDD6FE',
    formats: ['PDF', 'DOCX'],
  },
  {
    id: 'D3',
    title: 'D3 — Benchmark & Opportunity Map',
    desc: 'Cross-entity pillar score comparison, internal benchmarking, external GCC and global industry benchmarking, and 2×2 opportunity prioritization matrix.',
    icon: '🌍',
    color: '#059669',
    bg: '#ECFDF5',
    border: '#6EE7B7',
    formats: ['PDF', 'PPTX'],
  },
  {
    id: 'D4',
    title: 'D4 — AI Video Script',
    desc: 'A 3–5 minute professional video script summarizing key findings, top strengths and gaps, SWOT highlights, and strategic imperatives — formatted with [SCENE], [NARRATOR], and [VISUAL CUE] blocks.',
    icon: '🎬',
    color: '#F59E0B',
    bg: '#FFFBEB',
    border: '#FDE68A',
    formats: ['PDF', 'DOCX'],
    isNew: true,
  },
  {
    id: 'D5',
    title: 'D5 — Stakeholder Interview Questions',
    desc: 'Leadership question set (C-suite/board), team lead question set (operational), and gap-filling questions — each tagged with pillar, element, and priority.',
    icon: '🎤',
    color: '#10B981',
    bg: '#ECFDF5',
    border: '#6EE7B7',
    formats: ['PDF', 'DOCX'],
  },
  {
    id: 'D6',
    title: 'D6 — Full Strategy Document',
    desc: 'Complete strategy document: Vision → Strategic Options → Outcomes → KPIs → Initiatives → Projects, with executive summary, performance tables, and strategic narrative.',
    icon: '📋',
    color: '#EC4899',
    bg: '#FDF2F8',
    border: '#FBCFE8',
    formats: ['PDF', 'DOCX', 'PPTX'],
  },
]

export default function OutputsPage() {
  const { project, setProject } = useStore()
  const [generating, setGenerating] = useState<string | null>(null)
  const [viewing, setViewing] = useState<any | null>(null)
  const [copied, setCopied] = useState<string | null>(null)

  if (!project) return null

  const outputs = project.outputs || {}
  const assessedCount = Object.values(project.assessment.pillars).filter((p: any) => p.status === 'complete').length
  const hasSwot = (project.assessment.consolidatedSwot?.strengths?.length || 0) > 0

  async function generateReport(reportId: string) {
    setGenerating(reportId)
    try {
      await aiApi.generateReport(project.id, reportId)
      const updated = await projectsApi.get(project.id)
      setProject(updated.data)
    } catch (e: any) {
      alert('Generation failed: ' + (e.response?.data?.error || e.message))
    }
    setGenerating(null)
  }

  const [exporting, setExporting] = useState<string | null>(null)

  async function copyToClipboard(content: string, id: string) {
    await navigator.clipboard.writeText(content)
    setCopied(id)
    setTimeout(() => setCopied(null), 2000)
  }

  async function downloadPdf(reportId: string) {
    setExporting(`${reportId}-pdf`)
    try {
      const res = await axios.post(`/api/export/${project.id}/pdf/${reportId}`, {}, { responseType: 'blob', withCredentials: true })
      const url = URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }))
      const a = document.createElement('a')
      const filename = res.headers['content-disposition']?.match(/filename="(.+)"/)?.[1] || `${project.entityName}_${reportId}.pdf`
      a.href = url; a.download = filename; a.click()
      URL.revokeObjectURL(url)
    } catch (e: any) {
      const errText = e.response?.data ? await e.response.data.text() : e.message
      alert('PDF export failed: ' + (errText || e.message))
    } finally {
      setExporting(null)
    }
  }

  async function downloadPptx(reportId: string) {
    setExporting(`${reportId}-pptx`)
    try {
      const res = await axios.post(`/api/export/${project.id}/pptx/${reportId}`, {}, { responseType: 'blob', withCredentials: true })
      const url = URL.createObjectURL(new Blob([res.data], { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' }))
      const a = document.createElement('a')
      const filename = res.headers['content-disposition']?.match(/filename="(.+)"/)?.[1] || `${project.entityName}_${reportId}.pptx`
      a.href = url; a.download = filename; a.click()
      URL.revokeObjectURL(url)
    } catch (e: any) {
      const errText = e.response?.data ? await e.response.data.text() : e.message
      alert('PPTX export failed: ' + (errText || e.message))
    } finally {
      setExporting(null)
    }
  }

  const overallScore = Object.values(project.assessment.pillars).filter((p: any) => p.finalScore).reduce((s: number, p: any, _, arr: any) => s + p.finalScore / arr.length, 0) || 0

  return (
    <div style={{ padding: '32px', maxWidth: '980px' }}>
      <div style={{ marginBottom: '28px' }}>
        <div style={{ fontSize: '12px', color: 'var(--sia-medium-gray)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '6px', fontWeight: 600 }}>Export Center</div>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '28px', fontWeight: 800, color: 'var(--sia-navy)' }}>Assessment Deliverables</h1>
        <div style={{ fontSize: '13px', color: 'var(--sia-cool-gray)', marginTop: '6px' }}>Generate AI-powered consulting reports ready for client presentation — D1 through D6</div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px', marginBottom: '28px' }}>
        {[
          { label: 'Pillars Assessed', value: `${assessedCount}/8`, ok: assessedCount >= 4 },
          { label: 'SWOT Consolidated', value: hasSwot ? 'Yes ✓' : 'No', ok: hasSwot },
          { label: 'Overall Maturity Score', value: overallScore > 0 ? `${overallScore.toFixed(1)}/5` : '—', ok: overallScore > 0 },
        ].map(stat => (
          <div key={stat.label} className="card" style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: stat.ok ? '#ECFDF5' : '#FFFBEB', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              {stat.ok ? <CheckCircle size={16} color="#10B981" /> : <FileText size={16} color="#F59E0B" />}
            </div>
            <div>
              <div style={{ fontSize: '11px', color: 'var(--sia-medium-gray)', textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: 500 }}>{stat.label}</div>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: '18px', fontWeight: 700, color: stat.ok ? 'var(--sia-green)' : 'var(--sia-amber)' }}>{stat.value}</div>
            </div>
          </div>
        ))}
      </div>

      {assessedCount === 0 && (
        <div className="card" style={{ padding: '28px', background: '#FFFBEB', border: '1px solid #FDE68A', marginBottom: '20px', display: 'flex', alignItems: 'flex-start', gap: '14px' }}>
          <span style={{ fontSize: '24px' }}>⚠️</span>
          <div>
            <div style={{ fontSize: '15px', fontWeight: 600, color: '#92400E', marginBottom: '6px' }}>No Pillar Assessments Completed</div>
            <p style={{ fontSize: '13px', color: '#92400E', lineHeight: 1.6 }}>
              Complete at least 1–2 pillar assessments before generating reports. Go to the Assessment page to run AI assessments using your uploaded documents.
            </p>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {REPORTS.map(report => {
          const output = outputs[report.id]
          const isGenerated = output?.generated && output?.content
          const isGenerating = generating === report.id

          return (
            <div key={report.id} className="card" style={{ overflow: 'hidden' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '16px', padding: '24px' }}>
                <div style={{ width: '52px', height: '52px', borderRadius: 'var(--radius-lg)', background: report.bg, border: `1px solid ${report.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '24px', flexShrink: 0, position: 'relative' }}>
                  {report.icon}
                  {(report as any).isNew && (
                    <span style={{ position: 'absolute', top: '-6px', right: '-6px', fontSize: '8px', fontWeight: 700, background: 'var(--sia-teal)', color: 'var(--sia-navy)', padding: '2px 5px', borderRadius: '8px', textTransform: 'uppercase' }}>New</span>
                  )}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '6px' }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                        <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '16px', fontWeight: 700, color: 'var(--sia-navy)' }}>{report.title}</h3>
                        <div style={{ display: 'flex', gap: '4px' }}>
                          {report.formats.map(fmt => (
                            <span key={fmt} style={{ fontSize: '9px', fontWeight: 600, padding: '2px 6px', borderRadius: '4px', background: 'var(--sia-light-gray)', color: 'var(--sia-cool-gray)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{fmt}</span>
                          ))}
                        </div>
                      </div>
                      <p style={{ fontSize: '13px', color: 'var(--sia-cool-gray)', lineHeight: 1.5 }}>{report.desc}</p>
                    </div>
                    {isGenerated && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0, marginLeft: '16px' }}>
                        <CheckCircle size={14} color="var(--sia-green)" />
                        <span style={{ fontSize: '11px', color: 'var(--sia-green)', fontWeight: 600 }}>Generated</span>
                      </div>
                    )}
                  </div>

                  {isGenerated && output.lastGenerated && (
                    <div style={{ fontSize: '11px', color: 'var(--sia-medium-gray)', marginBottom: '12px' }}>Last generated: {new Date(output.lastGenerated).toLocaleString()}</div>
                  )}

                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    <button className="btn btn-primary btn-sm" data-testid={`button-generate-${report.id}`} onClick={() => generateReport(report.id)} disabled={isGenerating}>
                      {isGenerating ? <><Loader2 size={13} className="spinner" /> Generating...</> : isGenerated ? <><RefreshCw size={13} /> Regenerate</> : <><span>✨</span> Generate {report.id}</>}
                    </button>
                    {isGenerated && (
                      <>
                        <button className="btn btn-ghost btn-sm" data-testid={`button-preview-${report.id}`} onClick={() => setViewing(report)}>
                          <Eye size={13} /> Preview
                        </button>
                        <button className="btn btn-ghost btn-sm" data-testid={`button-copy-${report.id}`} onClick={() => copyToClipboard(output.content, report.id)}>
                          {copied === report.id ? <CheckCircle size={13} color="var(--sia-green)" /> : <Copy size={13} />}
                          {copied === report.id ? 'Copied!' : 'Copy'}
                        </button>
                        {report.formats.includes('PDF') && (
                          <button className="btn btn-secondary btn-sm" data-testid={`button-pdf-${report.id}`} onClick={() => downloadPdf(report.id)} disabled={exporting === `${report.id}-pdf`}>
                            {exporting === `${report.id}-pdf` ? <Loader2 size={13} className="spinner" /> : <Download size={13} />}
                            {exporting === `${report.id}-pdf` ? 'Exporting…' : 'PDF'}
                          </button>
                        )}
                        {report.formats.includes('PPTX') && (
                          <button className="btn btn-secondary btn-sm" data-testid={`button-pptx-${report.id}`} onClick={() => downloadPptx(report.id)} disabled={exporting === `${report.id}-pptx`}>
                            {exporting === `${report.id}-pptx` ? <Loader2 size={13} className="spinner" /> : <Download size={13} />}
                            {exporting === `${report.id}-pptx` ? 'Exporting…' : 'PPTX'}
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </div>

              {isGenerated && (
                <div style={{ borderTop: '1px solid rgba(69,85,105,0.08)', padding: '12px 24px', background: 'var(--sia-light-gray)' }}>
                  <div style={{ fontSize: '12px', color: 'var(--sia-medium-gray)', fontFamily: 'monospace', lineHeight: 1.5, maxHeight: '80px', overflow: 'hidden', maskImage: 'linear-gradient(to bottom, black 50%, transparent)' }}>
                    {output.content.substring(0, 400)}
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {viewing && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(10,21,30,0.8)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 100, padding: '24px', overflowY: 'auto' }} onClick={() => setViewing(null)}>
          <div style={{ background: 'white', borderRadius: 'var(--radius-lg)', maxWidth: '800px', width: '100%', maxHeight: '90vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }} onClick={e => e.stopPropagation()}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid rgba(69,85,105,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ fontSize: '20px' }}>{viewing.icon}</span>
                <span style={{ fontSize: '15px', fontWeight: 700, color: 'var(--sia-navy)' }}>{viewing.title}</span>
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button className="btn btn-ghost btn-sm" onClick={() => copyToClipboard(outputs[viewing.id]?.content || '', viewing.id)}>
                  {copied === viewing.id ? <CheckCircle size={13} color="var(--sia-green)" /> : <Copy size={13} />}
                  {copied === viewing.id ? 'Copied!' : 'Copy'}
                </button>
                {viewing.formats?.includes('PDF') && (
                  <button className="btn btn-secondary btn-sm" onClick={() => downloadPdf(viewing.id)} disabled={exporting === `${viewing.id}-pdf`}>
                    {exporting === `${viewing.id}-pdf` ? <Loader2 size={13} className="spinner" /> : <Download size={13} />}
                    PDF
                  </button>
                )}
                {viewing.formats?.includes('PPTX') && (
                  <button className="btn btn-secondary btn-sm" onClick={() => downloadPptx(viewing.id)} disabled={exporting === `${viewing.id}-pptx`}>
                    {exporting === `${viewing.id}-pptx` ? <Loader2 size={13} className="spinner" /> : <Download size={13} />}
                    PPTX
                  </button>
                )}
                <button onClick={() => setViewing(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--sia-medium-gray)', padding: '4px' }}><X size={18} /></button>
              </div>
            </div>
            <div style={{ flex: 1, overflow: 'auto', padding: '24px', fontFamily: 'var(--font-body)', fontSize: '14px', lineHeight: 1.8, color: 'var(--sia-cool-gray)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              {outputs[viewing.id]?.content || ''}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
