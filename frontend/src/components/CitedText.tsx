import React, { useState } from 'react'
import { ExternalLink } from 'lucide-react'
import { useStore } from '../store/useStore'

export interface Citation {
  num: number
  mediaVersionId: string
}

/** Parse `**[<48,uuid>, <32,uuid2>]**` markers out of a text string.
 *  Returns segments ready to render plus all unique citations found. */
export function parseCitations(text: string): {
  segments: Array<{ type: 'text'; value: string } | { type: 'cite'; cites: Citation[] }>
  allCitations: Citation[]
} {
  const segments: Array<{ type: 'text'; value: string } | { type: 'cite'; cites: Citation[] }> = []
  // Match: **[<number,uuid>, ...]**
  const RE = /\*\*\[(<\d+,[0-9a-f-]+>(?:,\s*<\d+,[0-9a-f-]+>)*)\]\*\*/g
  const citationRE = /<(\d+),([0-9a-f-]+)>/g
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = RE.exec(text)) !== null) {
    // text segment before this citation block
    if (match.index > lastIndex) {
      segments.push({ type: 'text', value: text.slice(lastIndex, match.index) })
    }
    // parse the individual <N,uuid> entries inside the block
    const cites: Citation[] = []
    let cm: RegExpExecArray | null
    citationRE.lastIndex = 0
    while ((cm = citationRE.exec(match[0])) !== null) {
      cites.push({ num: parseInt(cm[1], 10), mediaVersionId: cm[2] })
    }
    if (cites.length > 0) segments.push({ type: 'cite', cites })
    lastIndex = RE.lastIndex
  }
  // trailing text
  if (lastIndex < text.length) {
    segments.push({ type: 'text', value: text.slice(lastIndex) })
  }

  // collect unique citations (dedup by mediaVersionId)
  const seen = new Set<string>()
  const allCitations: Citation[] = []
  for (const seg of segments) {
    if (seg.type === 'cite') {
      for (const c of seg.cites) {
        if (!seen.has(c.mediaVersionId)) {
          seen.add(c.mediaVersionId)
          allCitations.push(c)
        }
      }
    }
  }

  return { segments, allCitations }
}

/** Small inline badge showing a citation number with a hover popover for source title + link. */
export function SourceBadge({ num, onClick }: { num: number; onClick?: () => void }) {
  const [open, setOpen] = useState(false)
  const globalSourceMeta = useStore(s => s.globalSourceMeta)
  const meta = globalSourceMeta[num.toString()]

  const badge = (
    <span
      onClick={() => { setOpen(v => !v); onClick?.() }}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      title={meta?.title ?? `Source #${num}`}
      style={{
        position: 'relative',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        minWidth: '18px',
        height: '18px',
        padding: '0 5px',
        marginLeft: '2px',
        borderRadius: '9px',
        background: 'var(--sia-navy)',
        color: 'white',
        fontSize: '10px',
        fontWeight: 700,
        lineHeight: 1,
        cursor: 'pointer',
        verticalAlign: 'middle',
        flexShrink: 0,
        userSelect: 'none',
        letterSpacing: 0,
      }}
    >
      {num}
      {meta && open && (
        <span
          style={{
            position: 'absolute',
            bottom: 'calc(100% + 6px)',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 50,
            background: '#fff',
            border: '1px solid rgba(69,85,105,0.18)',
            borderRadius: '8px',
            boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
            padding: '8px 12px',
            minWidth: '180px',
            maxWidth: '260px',
            whiteSpace: 'normal',
            pointerEvents: 'auto',
          }}
          onMouseEnter={() => setOpen(true)}
          onMouseLeave={() => setOpen(false)}
        >
          <div
            style={{
              fontSize: '12px',
              fontWeight: 600,
              color: 'var(--sia-navy)',
              marginBottom: meta.url ? '6px' : 0,
              lineHeight: '1.4',
            }}
          >
            {meta.title}
          </div>
          {meta.url && (
            <a
              href={meta.url}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                fontSize: '11px',
                color: 'var(--sia-teal)',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '3px',
                textDecoration: 'none',
                fontWeight: 500,
              }}
              onClick={e => e.stopPropagation()}
            >
              View source <ExternalLink size={10} />
            </a>
          )}
        </span>
      )}
    </span>
  )

  return badge
}

interface CitedTextProps {
  text: string
  /** If provided, badge clicks will call this with the citation chunk number */
  onCiteClick?: (citation: Citation) => void
  style?: React.CSSProperties
  className?: string
}

/**
 * Renders a text string, replacing `**[<N,uuid>]**` citation markers with
 * small inline numbered badges.  Plain text between markers is rendered
 * as-is preserving newlines.
 */
export function CitedText({ text, onCiteClick, style, className }: CitedTextProps) {
  if (!text) return null
  const { segments } = parseCitations(text)

  return (
    <span style={style} className={className}>
      {segments.map((seg, i) => {
        if (seg.type === 'text') {
          // Preserve newlines by splitting on \n
          const parts = seg.value.split('\n')
          return parts.map((part, j) => (
            <React.Fragment key={`${i}-${j}`}>
              {j > 0 && <br />}
              {part}
            </React.Fragment>
          ))
        }
        return (
          <React.Fragment key={i}>
            {seg.cites.map((c, ci) => (
              <SourceBadge
                key={ci}
                num={c.num}
                onClick={onCiteClick ? () => onCiteClick(c) : undefined}
              />
            ))}
          </React.Fragment>
        )
      })}
    </span>
  )
}
