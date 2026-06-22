'use client'
import React, { useState, useCallback, useRef } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Copy, Check, Pencil, Eye, X, FileDown } from 'lucide-react'

// Strip any trailing JSON appendix blocks the agent may have appended to an older report
function cleanReportContent(raw: string): string {
  return raw
    .replace(/\n#{1,3}\s*(Appendix|appendix)[^\n]*\n[\s\S]*?```[\s\S]*?```[\s\S]*/g, '')
    .replace(/\n#{1,3}\s*(Appendix|appendix)[^\n]*\n[\s\S]*/g, '')
    .trimEnd()
}

interface Props {
  reportId: string
  reportTitle: string
  content: string
  lastGenerated?: string
  onSave: (newContent: string) => void
  onClose: () => void
}

export default function MarkdownReportPanel({ reportId, reportTitle, content, lastGenerated, onSave, onClose }: Props) {
  const cleaned = cleanReportContent(content)
  const [mode, setMode] = useState<'view' | 'edit'>('view')
  const [draft, setDraft] = useState(cleaned)
  const [copied, setCopied] = useState(false)
  const printRef = useRef<HTMLDivElement>(null)

  const handleDownloadPDF = useCallback(() => {
    const bodyHtml = printRef.current?.innerHTML
    if (!bodyHtml) return

    const printWindow = window.open('', '_blank', 'width=960,height=800')
    if (!printWindow) return

    const date = lastGenerated ? new Date(lastGenerated).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })

    printWindow.document.write(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${reportTitle} — SIA Partners</title>
<style>
  @page { margin: 18mm 20mm; }
  * { box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 13.5px;
    line-height: 1.75;
    color: #2D3748;
    margin: 0;
    padding: 0;
  }
  .sia-cover {
    border-bottom: 3px solid #C9A95E;
    margin-bottom: 36px;
    padding-bottom: 18px;
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
  }
  .sia-cover-left .tag {
    font-size: 10px;
    font-weight: 700;
    color: #C9A95E;
    letter-spacing: 1.2px;
    text-transform: uppercase;
    margin-bottom: 4px;
  }
  .sia-cover-left .title {
    font-size: 20px;
    font-weight: 800;
    color: #1B2A4A;
    margin: 0;
  }
  .sia-cover-right {
    text-align: right;
    font-size: 10.5px;
    color: #7B8A9A;
    line-height: 1.6;
  }
  .sia-cover-right strong { color: #1B2A4A; display: block; font-size: 12px; }
  h1 { font-size: 20px; font-weight: 800; color: #1B2A4A; margin: 0 0 6px 0; padding-bottom: 10px; border-bottom: 2px solid #C9A95E; }
  h2 { font-size: 16px; font-weight: 700; color: #1B2A4A; margin: 28px 0 10px 0; padding-bottom: 6px; border-bottom: 1px solid #E8ECEF; }
  h3 { font-size: 14px; font-weight: 700; color: #1B2A4A; margin: 20px 0 8px 0; }
  h4 { font-size: 12px; font-weight: 700; color: #374151; margin: 14px 0 5px 0; text-transform: uppercase; letter-spacing: 0.5px; }
  p { margin: 0 0 12px 0; }
  ul, ol { margin: 0 0 12px 0; padding-left: 20px; }
  li { margin-bottom: 5px; }
  li > ul, li > ol { margin-top: 4px; margin-bottom: 2px; }
  strong { color: #1B2A4A; font-weight: 700; }
  em { color: #4A5568; }
  blockquote { margin: 16px 0; padding: 12px 18px; background: #EEF1F7; border-left: 4px solid #1B2A4A; border-radius: 0 6px 6px 0; font-style: italic; color: #374151; }
  blockquote p { margin: 0; }
  code { font-family: 'SFMono-Regular', Consolas, monospace; font-size: 11.5px; background: #F1F5F9; color: #1B2A4A; padding: 1px 5px; border-radius: 3px; }
  pre { background: #F1F5F9; border-radius: 7px; padding: 14px 16px; overflow-x: auto; margin: 14px 0; }
  pre code { background: none; padding: 0; }
  table { width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 12.5px; }
  thead tr { background: #1B2A4A; color: #fff; }
  thead th { padding: 9px 12px; text-align: left; font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: 0.4px; }
  tbody tr:nth-child(even) { background: #F8FAFB; }
  tbody td { padding: 8px 12px; border-bottom: 1px solid #E8ECEF; vertical-align: top; }
  hr { border: none; border-top: 1px solid #E8ECEF; margin: 22px 0; }
  a { color: #1B2A4A; text-decoration: underline; text-decoration-color: #C9A95E; }
  .sia-footer { margin-top: 40px; padding-top: 12px; border-top: 1px solid #E8ECEF; display: flex; justify-content: space-between; font-size: 10px; color: #A0ADB8; }
  @media print {
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    h2 { page-break-after: avoid; }
    table { page-break-inside: avoid; }
    blockquote { page-break-inside: avoid; }
  }
</style>
</head>
<body>
<div class="sia-cover">
  <div class="sia-cover-left">
    <div class="tag">${reportId} Report &nbsp;·&nbsp; SIA Partners</div>
    <h2 class="title" style="border:none;margin:0;padding:0;font-size:20px">${reportTitle}</h2>
  </div>
  <div class="sia-cover-right">
    <strong>Confidential</strong>
    Generated ${date}
  </div>
</div>
${bodyHtml}
<div class="sia-footer">
  <span>SIA Partners &mdash; Strategy Assessment Platform</span>
  <span>Confidential</span>
</div>
</body>
</html>`)

    printWindow.document.close()
    printWindow.focus()
    setTimeout(() => {
      printWindow.print()
      printWindow.close()
    }, 600)
  }, [reportId, reportTitle, lastGenerated])

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(mode === 'edit' ? draft : cleaned)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // fallback for older browsers
      const el = document.createElement('textarea')
      el.value = mode === 'edit' ? draft : cleaned
      document.body.appendChild(el)
      el.select()
      document.execCommand('copy')
      document.body.removeChild(el)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }, [content, draft, mode])

  const handleSave = () => {
    onSave(draft)
    setMode('view')
  }

  const handleDiscard = () => {
    setDraft(content)
    setMode('view')
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      background: 'rgba(10, 20, 40, 0.55)',
      display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
      padding: '32px 16px', overflowY: 'auto',
    }} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{
        background: '#fff',
        borderRadius: '12px',
        width: '100%',
        maxWidth: '860px',
        boxShadow: '0 24px 80px rgba(10,20,40,0.22)',
        display: 'flex',
        flexDirection: 'column',
        maxHeight: '90vh',
      }}>
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '18px 24px',
          borderBottom: '1px solid #E8ECEF',
          flexShrink: 0,
        }}>
          <div>
            <div style={{ fontSize: '11px', color: '#7B8A9A', textTransform: 'uppercase', letterSpacing: '1px', fontWeight: 600, marginBottom: '2px' }}>{reportId} Report</div>
            <div style={{ fontSize: '16px', fontWeight: 700, color: '#1B2A4A' }}>{reportTitle}</div>
            {lastGenerated && (
              <div style={{ fontSize: '11px', color: '#A0ADB8', marginTop: '2px' }}>
                Generated {new Date(lastGenerated).toLocaleString()}
              </div>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {/* Download PDF */}
            <button
              onClick={handleDownloadPDF}
              title="Download as PDF"
              style={{
                display: 'flex', alignItems: 'center', gap: '6px',
                padding: '7px 14px',
                fontSize: '12px', fontWeight: 600,
                borderRadius: '7px',
                border: '1px solid #C9A95E',
                background: '#1B2A4A',
                color: '#fff',
                cursor: 'pointer',
              }}
            >
              <FileDown size={13} />
              Download PDF
            </button>

            {/* Copy */}
            <button
              onClick={handleCopy}
              title="Copy markdown"
              style={{
                display: 'flex', alignItems: 'center', gap: '6px',
                padding: '7px 14px',
                fontSize: '12px', fontWeight: 600,
                borderRadius: '7px',
                border: '1px solid #D1D9E0',
                background: copied ? '#ECFDF5' : '#F6F8FA',
                color: copied ? '#059669' : '#374151',
                cursor: 'pointer',
              }}
            >
              {copied ? <Check size={13} /> : <Copy size={13} />}
              {copied ? 'Copied!' : 'Copy'}
            </button>

            {/* Edit / View toggle */}
            {mode === 'view' ? (
              <button
                onClick={() => { setDraft(content); setMode('edit') }}
                style={{
                  display: 'flex', alignItems: 'center', gap: '6px',
                  padding: '7px 14px',
                  fontSize: '12px', fontWeight: 600,
                  borderRadius: '7px',
                  border: '1px solid #D1D9E0',
                  background: '#F6F8FA',
                  color: '#374151',
                  cursor: 'pointer',
                }}
              >
                <Pencil size={13} /> Edit
              </button>
            ) : (
              <>
                <button
                  onClick={handleSave}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '6px',
                    padding: '7px 14px',
                    fontSize: '12px', fontWeight: 600,
                    borderRadius: '7px',
                    border: 'none',
                    background: '#1B2A4A',
                    color: '#fff',
                    cursor: 'pointer',
                  }}
                >
                  <Check size={13} /> Save
                </button>
                <button
                  onClick={handleDiscard}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '6px',
                    padding: '7px 14px',
                    fontSize: '12px', fontWeight: 600,
                    borderRadius: '7px',
                    border: '1px solid #D1D9E0',
                    background: '#F6F8FA',
                    color: '#374151',
                    cursor: 'pointer',
                  }}
                >
                  <Eye size={13} /> Preview
                </button>
              </>
            )}

            {/* Close */}
            <button
              onClick={onClose}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                width: '32px', height: '32px',
                borderRadius: '7px',
                border: '1px solid #D1D9E0',
                background: '#F6F8FA',
                color: '#374151',
                cursor: 'pointer',
              }}
            >
              <X size={15} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflow: 'auto', padding: '28px 32px' }}>
          {mode === 'view' ? (
            <div className="markdown-report-body" ref={printRef}>
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {cleaned}
              </ReactMarkdown>
            </div>
          ) : (
            <textarea
              value={draft}
              onChange={e => setDraft(e.target.value)}
              spellCheck={false}
              style={{
                width: '100%',
                minHeight: '560px',
                fontFamily: '"SFMono-Regular", "Consolas", "Liberation Mono", monospace',
                fontSize: '13px',
                lineHeight: '1.65',
                color: '#1B2A4A',
                background: '#F8FAFC',
                border: '1px solid #D1D9E0',
                borderRadius: '8px',
                padding: '16px 18px',
                resize: 'vertical',
                outline: 'none',
                boxSizing: 'border-box',
              }}
            />
          )}
        </div>

        {/* Footer */}
        {mode === 'edit' && (
          <div style={{
            padding: '12px 24px',
            borderTop: '1px solid #E8ECEF',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexShrink: 0,
            background: '#FAFBFC',
            borderRadius: '0 0 12px 12px',
          }}>
            <span style={{ fontSize: '12px', color: '#7B8A9A' }}>Editing markdown — changes are saved to this project only</span>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button onClick={handleDiscard} style={{ padding: '7px 16px', fontSize: '12px', fontWeight: 600, borderRadius: '7px', border: '1px solid #D1D9E0', background: '#fff', color: '#374151', cursor: 'pointer' }}>Discard</button>
              <button onClick={handleSave} style={{ padding: '7px 16px', fontSize: '12px', fontWeight: 600, borderRadius: '7px', border: 'none', background: '#1B2A4A', color: '#fff', cursor: 'pointer' }}>Save changes</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
