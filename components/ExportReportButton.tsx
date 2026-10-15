'use client'
// "Export" control for an approved agent: asks the server to turn the whole conversation into a markdown
// report (LLM, cached after the first time), previews it, and exports PDF / Word / Markdown client-side.
import React, { useMemo, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { FileDown, Loader2, X, FileText, RefreshCw } from 'lucide-react'
import { wave1Api, sourcesApi } from '@/lib/api'
import { buildCitationMaps } from '@/lib/wave1Client'
import { downloadDocx, downloadPdf, type ReportMeta } from '@/lib/reportExport'

const oneLine = (t?: string) => (t || '').replace(/\s+/g, ' ').trim()

/** Resolves each cited source to a human-readable one-liner (document › section, summary, link) using the
 *  same metadata endpoints the Sources panel uses — raw source entries only carry ids. Best-effort: any
 *  lookup that fails falls back to whatever the entry itself holds. */
async function resolveReferences(projectId: string, sources: Record<string, any>) {
  const entries = Object.entries(sources)
  const isMv = (t?: string) => !!t && t.toLowerCase().includes('media_version')
  const entityIds = Array.from(new Set(entries.filter(([, s]) => s.type === 'entity' && (s.entityId || s.id)).map(([, s]) => s.entityId || s.id)))
  const mvIds = new Set<string>(entries.filter(([, s]) => isMv(s.type) && s.id).map(([, s]) => s.id))
  const meta: Record<string, any> = {}
  const absorb = (res: any) => { if (Array.isArray(res?.data)) for (const it of res.data) if (it.uuid) meta[it.uuid] = it }

  if (entityIds.length) absorb(await sourcesApi.entitiesBatch(projectId, entityIds).catch(() => null))
  // Entities point at their parent document by mediaVersionId — fetch those names too.
  for (const id of entityIds) { const mv = meta[id]?.mediaVersionId; if (mv) mvIds.add(mv) }
  for (const [, s] of entries) if (s.type === 'entity' && !meta[s.entityId || s.id] && (s.mediaVersionId || s.parentId)) mvIds.add(s.mediaVersionId || s.parentId)
  if (mvIds.size) absorb(await sourcesApi.batch(projectId, Array.from(mvIds)).catch(() => null))

  return entries.map(([n, s]) => {
    let title: string | undefined, description: string | undefined, url: string | undefined = s.url
    if (s.type === 'entity') {
      const m = meta[s.entityId || s.id]
      const parent = meta[m?.mediaVersionId || s.mediaVersionId || s.parentId]?.name
      const name = m?.name || s.header
      title = parent && name && parent !== name ? `${parent} › ${name}` : name || parent
      description = m?.summary || s.description
      url = m?.externalLink || url
    } else if (isMv(s.type)) {
      const m = meta[s.id]
      title = m?.name || s.header
      description = m?.summary || s.description
      url = m?.externalLink || url
    } else {
      title = s.header || s.url
      description = s.description
    }
    return { n: Number(n), type: s.type, title: oneLine(title) || undefined, description: oneLine(description).slice(0, 300) || undefined, url }
  })
}

interface Props {
  projectId: string
  entityId: string
  agentId: string
  title: string
  chatHistory: any[]
  /** Compact styling for the small agent cards. */
  compact?: boolean
}

export function ExportReportButton({ projectId, entityId, agentId, title, chatHistory, compact }: Props) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [report, setReport] = useState<{ markdown: string; entityName: string; generatedAt: string } | null>(null)
  const [busy, setBusy] = useState<'docx' | 'pdf' | null>(null)
    const maps = useMemo(() => buildCitationMaps(chatHistory), [chatHistory])

  async function generate(force = false) {
    setLoading(true); setError('')
    try {
      const sources = await resolveReferences(projectId, maps.remappedSources)
      const r = await wave1Api.generateReport(projectId, entityId, agentId, { title, tokenToNum: maps.tokenToNum, sources, force })
      setReport({ markdown: r.markdown, entityName: r.entityName, generatedAt: r.generatedAt })
    } catch (e: any) {
      setError(e.response?.data?.error || e.message || 'Report generation failed')
    }
    setLoading(false)
  }

  function openModal(e: React.MouseEvent) {
    e.stopPropagation()
    setOpen(true)
    if (!report && !loading) generate()
  }

  const meta: ReportMeta | null = report ? { title, entityName: report.entityName || 'Entity', generatedAt: report.generatedAt } : null

  return (
    <>
      <button
        className="btn btn-ghost btn-sm"
        style={compact ? { padding: '3px 8px', fontSize: '11px' } : undefined}
        onClick={openModal}
        title="Export a report of this approved conversation"
      >
        <FileDown size={compact ? 11 : 13} /> Export
      </button>

      {open && (
        <div
          onClick={e => { e.stopPropagation(); if (e.target === e.currentTarget) setOpen(false) }}
          style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(10,20,40,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px 16px', pointerEvents: 'auto' }}
        >
          <div style={{ background: '#fff', borderRadius: '12px', width: '100%', maxWidth: '900px', maxHeight: '92vh', display: 'flex', flexDirection: 'column', boxShadow: '0 24px 80px rgba(10,20,40,0.22)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', padding: '14px 20px', borderBottom: '1px solid rgba(23,48,68,0.08)', flexWrap: 'wrap' }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--sia-navy)' }}>{title}</div>
                <div style={{ fontSize: '11.5px', color: 'var(--sia-medium-gray)' }}>
                  Export report{report?.generatedAt ? ` · saved ${new Date(report.generatedAt).toLocaleString()}` : ''}
                </div>
              </div>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                <button className="btn btn-primary btn-sm" disabled={!report || loading || busy !== null}
                  onClick={async () => {
                    if (!report || !meta) return
                    setBusy('pdf')
                    try { await downloadPdf(report.markdown, meta) } catch (e: any) { alert('PDF export failed: ' + e.message) }
                    setBusy(null)
                  }}>
                  {busy === 'pdf' ? <Loader2 size={13} className="spinner" /> : <FileDown size={13} />} PDF
                </button>
                <button className="btn btn-secondary btn-sm" disabled={!report || loading || busy !== null}
                  onClick={async () => {
                    if (!report || !meta) return
                    setBusy('docx')
                    try { await downloadDocx(report.markdown, meta) } catch (e: any) { alert('Word export failed: ' + e.message) }
                    setBusy(null)
                  }}>
                  {busy === 'docx' ? <Loader2 size={13} className="spinner" /> : <FileText size={13} />} Word
                </button>
                <button className="btn btn-ghost btn-sm" disabled={loading} onClick={() => generate(true)} title="Regenerate with the LLM">
                  <RefreshCw size={13} /> Regenerate
                </button>
                <button className="btn btn-ghost btn-sm" onClick={() => setOpen(false)} aria-label="Close"><X size={14} /></button>
              </div>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: '24px 32px' }}>
              {loading && (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px', padding: '60px 0', color: 'var(--sia-medium-gray)', fontSize: '13px' }}>
                  <Loader2 size={22} className="spinner" />
                  Writing the report from the full conversation — this can take a few minutes…
                </div>
              )}
              {!loading && error && (
                <div style={{ color: 'var(--sia-red)', fontSize: '13px', padding: '20px 0' }}>
                  {error} <button className="btn btn-ghost btn-sm" style={{ marginLeft: '8px' }} onClick={() => generate()}>Retry</button>
                </div>
              )}
              {!loading && report && (
                <div className="report-preview" style={{ fontSize: '13.5px', lineHeight: 1.7, color: '#2D3748' }}>
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{report.markdown}</ReactMarkdown>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
