'use client'
import React, { useEffect, useRef, useState } from 'react'
import { Globe, Layers, FileText, ExternalLink, X, Loader2, ChevronRight, ChevronDown, ChevronUp } from 'lucide-react'
import { type Citation } from './CitedText'
import { sourcesApi } from '@/lib/api'
import { useStore } from '@/store/useStore'

/**
 * SourceInfo — mirrors the shape of entries in the SiaGPT NEW_SOURCES SSE event.
 * Keys are source-number strings ("1", "2", …).
 */
export type NewSource = {
  id: string
  type: string
  /** Present for "entity" type sources — the entity/chunk ID for metadata enrichment */
  entityId?: string
  /** Present for media_version sources — direct version ID */
  mediaVersionId?: string
  /** Parent collection ID */
  collectionId?: string
  /** Legacy parent-ref fields */
  mediaId?: string
  parentId?: string
  /** Direct URL (web / media_version sources) */
  url?: string
  /** Title / heading */
  header?: string
  description?: string
}

/** Returns true when the source type represents a media/document version chunk. */
export function isMediaVersionType(type: string): boolean {
  return type.toLowerCase().includes('media_version')
}

// ─── Grouping logic ────────────────────────────────────────────────────────────

interface SourceGroup {
  parentMediaVersionId: string
  parentName: string
  /** [sourceNum, source, entityMeta] */
  children: Array<[string, NewSource, any]>
}

/**
 * Groups entity sources (type === 'entity') that share the same parent document
 * under a SourceGroup using the mediaVersionId returned by the entities-batch API.
 * Web/non-entity sources are returned as standalone entries.
 */
function buildGroups(
  sources: Array<[string, NewSource]>,
  batchMeta: Record<string, any>,
): { groups: SourceGroup[]; standalone: Array<[string, NewSource]> } {
  const groupMap: Record<string, SourceGroup> = {}
  const standalone: Array<[string, NewSource]> = []

  for (const [num, src] of sources) {
    const isEntityType = src.type === 'entity'
    const meta = isEntityType ? batchMeta[src.entityId || src.id] : null
    // parentRef: from fetched entity metadata OR from source fields directly
    const parentMvId =
      meta?.mediaVersionId ||
      src.mediaVersionId ||
      src.collectionId ||
      src.mediaId ||
      src.parentId

    if (isEntityType && parentMvId) {
      if (!groupMap[parentMvId]) {
        const parentMeta = batchMeta[parentMvId]
        groupMap[parentMvId] = {
          parentMediaVersionId: parentMvId,
          parentName: parentMeta?.name || meta?.name || parentMvId.slice(0, 8) + '…',
          children: [],
        }
      }
      groupMap[parentMvId].children.push([num, src, meta])
    } else {
      standalone.push([num, src])
    }
  }

  return { groups: Object.values(groupMap), standalone }
}

interface SourcesPanelProps {
  projectId: string
  /** Citations parsed from the AI text — used to fetch batch media metadata */
  citations: Citation[]
  /** Keyed by source number string; captured from SiaGPT NEW_SOURCES SSE event */
  newSources?: Record<string, NewSource>
  /** When set, the panel auto-switches tab and scrolls to this source number */
  activeBadgeNum?: number | null
  open?: boolean
  onClose?: () => void
  /** When true, renders flush without card chrome (for sidebar use) */
  sidebar?: boolean
  /** Called with the resolved {num: {title,url}} map once metadata fetch completes. Defaults to writing
   *  the app-wide citation-badge cache; pass a local setter when this instance's source numbers are scoped
   *  to one conversation and would otherwise collide with unrelated numbers elsewhere in the app. */
  onResolvedMeta?: (meta: Record<string, { title: string; url: string | null }>) => void
}

export function SourcesPanel({
  projectId,
  citations,
  newSources = {},
  activeBadgeNum,
  open = false,
  onClose,
  sidebar = false,
  onResolvedMeta,
}: SourcesPanelProps) {
  const [tab, setTab] = useState<'cited' | 'explored'>('cited')
  const [batchMeta, setBatchMeta] = useState<Record<string, any>>({})
  const [loading, setLoading] = useState(false)
  const [fetched, setFetched] = useState(false)
  const itemRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const setGlobalSourceMeta = useStore(s => s.setGlobalSourceMeta)
  const applyResolvedMeta = onResolvedMeta ?? setGlobalSourceMeta

  // Build effective sources: newSources (from NEW_SOURCES SSE) + fallback MEDIA_VERSION
  // entries from citation UUIDs for any number not already in newSources.
  const effectiveSources: Record<string, NewSource> = { ...newSources }
  for (const c of citations) {
    const key = c.num.toString()
    if (!effectiveSources[key] && c.mediaVersionId) {
      effectiveSources[key] = { id: c.mediaVersionId, type: 'MEDIA_VERSION' }
    }
  }
  const sortByNum = (a: [string, NewSource], b: [string, NewSource]) => parseInt(a[0]) - parseInt(b[0])

  // 'cited' tab: entity sources + web sources (WEB_SEARCH / WEB_VERSION / web)
  // 'explored' tab: MEDIA_VERSION sources (broader explored docs)
  const citedSources = Object.entries(effectiveSources)
    .filter(([, s]) => !isMediaVersionType(s.type))
    .sort(sortByNum)
  const exploredSources = Object.entries(effectiveSources)
    .filter(([, s]) => isMediaVersionType(s.type))
    .sort(sortByNum)

  // Fetch metadata when the panel first opens:
  //   • entity sources  → POST /sources/entities-batch (using entityId)
  //   • MEDIA_VERSION sources + citation fallbacks → POST /sources/batch (using src.id / mediaVersionId)
  useEffect(() => {
    if (!open || fetched) return

    // Collect entity IDs (deduplicated) from entity-type cited sources
    const entityIds = Array.from(new Set(
      citedSources
        .filter(([, s]) => s.type === 'entity' && (s.entityId || s.id))
        .map(([, s]) => s.entityId || s.id)
    ))

    // Collect mediaVersion IDs from MEDIA_VERSION sources + citation fallbacks
    const mvIds = Array.from(new Set([
      ...exploredSources.map(([, s]) => s.id).filter(Boolean),
      ...citations.map(c => c.mediaVersionId).filter(Boolean),
    ]))

    if (entityIds.length === 0 && mvIds.length === 0) { setFetched(true); return }

    setLoading(true)
    const fetches: Promise<any>[] = []
    if (entityIds.length > 0) fetches.push(sourcesApi.entitiesBatch(projectId, entityIds).catch(() => ({ data: [] })))
    if (mvIds.length > 0) fetches.push(sourcesApi.batch(projectId, mvIds).catch(() => ({ data: [] })))

    Promise.all(fetches)
      .then(responses => {
        const meta: Record<string, any> = {}
        for (const res of responses) {
          if (Array.isArray(res.data)) {
            for (const item of res.data) if (item.uuid) meta[item.uuid] = item
          }
        }
        setBatchMeta(meta)

        // Build the global source metadata map used by CitationBadge popovers.
        // Maps source number string → { title, url }
        const resolved: Record<string, { title: string; url: string | null }> = {}
        for (const [num, src] of Object.entries(effectiveSources)) {
          if (src.type === 'entity') {
            const m = meta[src.entityId || src.id]
            const mvId = m?.mediaVersionId || src.id
            resolved[num] = {
              title: m?.name || src.header || 'Document',
              url: m?.path ? `/api/ai/${projectId}/sources/view/${mvId}` : m?.externalLink || null,
            }
          } else if (isMediaVersionType(src.type)) {
            const m = meta[src.id]
            resolved[num] = {
              title: m?.name || src.header || 'Document',
              url: m?.path ? `/api/ai/${projectId}/sources/view/${src.id}` : null,
            }
          } else {
            resolved[num] = {
              title: src.header || src.url || 'Source',
              url: src.url || null,
            }
          }
        }
        applyResolvedMeta(resolved)
      })
      .finally(() => { setFetched(true); setLoading(false) })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // When a badge is clicked: switch to the correct tab and scroll to that item
  useEffect(() => {
    if (activeBadgeNum == null || !open) return
    const numStr = activeBadgeNum.toString()
    const src = effectiveSources[numStr]
    if (src) {
      const targetTab = isMediaVersionType(src.type) ? 'explored' : 'cited'
      setTab(targetTab)
      setTimeout(() => {
        const el = itemRefs.current[numStr]
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
      }, 60)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeBadgeNum, open])

  if (!open) return null

  return (
    <div
      style={{
        background: '#fff',
        border: sidebar ? 'none' : '1px solid rgba(69,85,105,0.15)',
        borderRadius: sidebar ? '0' : '10px',
        overflow: 'hidden',
        marginTop: sidebar ? '0' : '12px',
        boxShadow: sidebar ? 'none' : '0 2px 8px rgba(0,0,0,0.08)',
        display: 'flex',
        flexDirection: 'column',
        height: sidebar ? '100%' : undefined,
      }}
    >
      {/* Header row */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: '12px 16px 0',
        }}
      >
        <span style={{ fontWeight: 700, fontSize: '14px', color: 'var(--sia-navy)', flex: 1 }}>
          Sources
        </span>
        {loading && (
          <Loader2
            size={14}
            color="var(--sia-teal)"
            style={{ marginRight: '8px', animation: 'spin 1s linear infinite' }}
          />
        )}
        {onClose && (
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px', color: 'var(--sia-cool-gray)' }}
          >
            <X size={16} />
          </button>
        )}
      </div>

      {/* Tab bar */}
      <div
        style={{
          display: 'flex',
          padding: '0 16px',
          borderBottom: '1px solid rgba(69,85,105,0.1)',
        }}
      >
        {(['cited', 'explored'] as const).map(t => {
          const count = t === 'cited' ? citedSources.length : exploredSources.length
          const active = tab === t
          return (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{
                background: 'none',
                border: 'none',
                borderBottom: active ? '2px solid var(--sia-teal)' : '2px solid transparent',
                padding: '10px 14px',
                cursor: 'pointer',
                fontWeight: active ? 700 : 500,
                fontSize: '12px',
                color: active ? 'var(--sia-navy)' : 'var(--sia-cool-gray)',
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
                marginBottom: '-1px',
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
              }}
            >
              {t.toUpperCase()}
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  minWidth: '18px',
                  height: '18px',
                  padding: '0 5px',
                  borderRadius: '9px',
                  background: active ? 'var(--sia-navy)' : 'rgba(69,85,105,0.12)',
                  color: active ? '#fff' : 'var(--sia-cool-gray)',
                  fontSize: '10px',
                  fontWeight: 700,
                }}
              >
                {count}
              </span>
            </button>
          )
        })}
      </div>

      {/* Source list */}
      <div style={{ maxHeight: sidebar ? undefined : '380px', flex: sidebar ? 1 : undefined, overflowY: 'auto', padding: '0' }}>

        {/* CITED tab — entity sources (grouped) + web sources (standalone) */}
        {tab === 'cited' && (() => {
          const entityEntries = citedSources.filter(([, s]) => s.type === 'entity')
          const nonEntityEntries = citedSources.filter(([, s]) => s.type !== 'entity')
          const { groups, standalone } = buildGroups(entityEntries, batchMeta)

          return (
            <>
              {/* Non-entity web sources as standalone cards */}
              {nonEntityEntries.map(([num, src]) => {
                const meta = batchMeta[src.id]
                const name = src.header || meta?.name || src.url || 'Web Source'
                const link = src.url || meta?.externalLink || null
                return (
                  <SourceCard
                    key={num}
                    refCallback={el => { itemRefs.current[num] = el }}
                    num={num}
                    icon={<Globe size={15} color="#6B7280" style={{ flexShrink: 0, marginTop: '3px' }} />}
                    name={name}
                    summary={src.description || meta?.summary}
                    link={link}
                    badgeLabel={src.type}
                    badgeBg="rgba(59,130,246,0.1)"
                    badgeFg="#3B82F6"
                    active={activeBadgeNum?.toString() === num}
                  />
                )
              })}

              {/* Grouped entity sources: parent doc header + collapsible children */}
              {groups.map(group => (
                <GroupCard
                  key={group.parentMediaVersionId}
                  group={group}
                  projectId={projectId}
                  batchMeta={batchMeta}
                  activeBadgeNum={activeBadgeNum}
                  refCallback={(num, el) => { itemRefs.current[num] = el }}
                />
              ))}

              {/* Entity sources without a resolvable parent: standalone */}
              {standalone.map(([num, src]) => {
                const meta = batchMeta[src.entityId || src.id]
                const name = meta?.name || src.header || (src.entityId ? src.entityId.slice(0, 8) + '…' : 'Document')
                const mvId = meta?.mediaVersionId || src.id
                const link = meta?.path
                  ? `/api/ai/${projectId}/sources/view/${mvId}`
                  : meta?.externalLink || null
                return (
                  <SourceCard
                    key={num}
                    refCallback={el => { itemRefs.current[num] = el }}
                    num={num}
                    icon={<FileText size={15} color="#6B7280" style={{ flexShrink: 0, marginTop: '3px' }} />}
                    name={name}
                    summary={meta?.summary || src.description}
                    link={link}
                    badgeLabel="DOCUMENT"
                    badgeBg="rgba(139,92,246,0.1)"
                    badgeFg="#7C3AED"
                    active={activeBadgeNum?.toString() === num}
                  />
                )
              })}
            </>
          )
        })()}

        {tab === 'cited' && citedSources.length === 0 && !loading && (
          <div style={{ padding: '24px 16px', textAlign: 'center', fontSize: '12px', color: 'var(--sia-cool-gray)' }}>
            No cited sources.
          </div>
        )}

        {/* EXPLORED tab — MEDIA_VERSION sources */}
        {tab === 'explored' && exploredSources.map(([num, src]) => {
          const meta = batchMeta[src.id]
          const name = meta?.name || src.header || (src.id ? src.id.slice(0, 8) + '…' : 'Document')
          const summary = meta?.summary || src.description
          // route document downloads through the backend proxy so S3 URLs are never exposed
          const link = meta?.path
            ? `/api/ai/${projectId}/sources/view/${src.id}`
            : meta?.externalLink || src.url || null
          return (
            <SourceCard
              key={num}
              refCallback={el => { itemRefs.current[num] = el }}
              num={num}
              icon={<Layers size={15} color="#6B7280" style={{ flexShrink: 0, marginTop: '3px' }} />}
              name={name}
              summary={summary}
              link={link}
              badgeLabel="MEDIA_VERSION"
              badgeBg="rgba(139,92,246,0.1)"
              badgeFg="#7C3AED"
              active={activeBadgeNum?.toString() === num}
            />
          )
        })}

        {tab === 'explored' && exploredSources.length === 0 && !loading && (
          <div style={{ padding: '24px 16px', textAlign: 'center', fontSize: '12px', color: 'var(--sia-cool-gray)' }}>
            No document sources explored.
          </div>
        )}
      </div>
    </div>
  )
}

// ─── GroupCard — parent document + collapsible children ────────────────────────
interface GroupCardProps {
  group: SourceGroup
  projectId: string
  batchMeta: Record<string, any>
  activeBadgeNum?: number | null
  refCallback: (num: string, el: HTMLDivElement | null) => void
}

function GroupCard({ group, projectId, batchMeta, activeBadgeNum, refCallback }: GroupCardProps) {
  const [expanded, setExpanded] = useState(true)
  const parentLink = group.parentMediaVersionId
    ? `/api/ai/${projectId}/sources/view/${group.parentMediaVersionId}`
    : null

  return (
    <div style={{ borderBottom: '1px solid rgba(69,85,105,0.08)' }}>
      {/* Parent row */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          padding: '10px 16px',
          background: 'rgba(69,85,105,0.03)',
          cursor: 'pointer',
          userSelect: 'none',
        }}
        onClick={() => setExpanded(v => !v)}
      >
        <Layers size={14} color="var(--sia-navy)" style={{ flexShrink: 0 }} />
        <span
          style={{
            flex: 1,
            fontWeight: 700,
            fontSize: '12px',
            color: 'var(--sia-navy)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={group.parentName}
        >
          {group.parentName}
        </span>
        <span
          style={{
            fontSize: '10px',
            fontWeight: 600,
            padding: '2px 7px',
            borderRadius: '4px',
            background: 'rgba(139,92,246,0.1)',
            color: '#7C3AED',
            marginRight: '4px',
            letterSpacing: '0.3px',
          }}
        >
          {group.children.length} chunk{group.children.length !== 1 ? 's' : ''}
        </span>
        {parentLink && (
          <a
            href={parentLink}
            target="_blank"
            rel="noopener noreferrer"
            onClick={e => e.stopPropagation()}
            style={{ color: 'var(--sia-teal)', flexShrink: 0 }}
          >
            <ExternalLink size={11} />
          </a>
        )}
        {expanded ? <ChevronUp size={13} color="var(--sia-cool-gray)" /> : <ChevronDown size={13} color="var(--sia-cool-gray)" />}
      </div>

      {/* Children */}
      {expanded && group.children.map(([num, src, meta]) => {
        const name = meta?.name || src.header || `Chunk #${num}`
        const summary = meta?.summary || src.description
        const mvId = meta?.mediaVersionId || src.id
        const link = meta?.path
          ? `/api/ai/${projectId}/sources/view/${mvId}`
          : meta?.externalLink || null

        const isActive = activeBadgeNum?.toString() === num
        return (
          <div
            key={num}
            ref={el => refCallback(num, el)}
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: '10px',
              padding: '10px 16px 10px 32px',
              background: isActive ? 'rgba(0,152,121,0.05)' : '#fff',
              transition: 'background 0.15s',
            }}
          >
            <FileText size={13} color="#9CA3AF" style={{ flexShrink: 0, marginTop: '3px' }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontWeight: 600,
                  fontSize: '12px',
                  color: 'var(--sia-navy)',
                  marginBottom: '2px',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
                title={name}
              >
                {name}
              </div>
              {summary && (
                <div
                  style={{
                    fontSize: '11px',
                    color: 'var(--sia-cool-gray)',
                    overflow: 'hidden',
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                    lineHeight: '1.4',
                    marginBottom: '4px',
                  } as React.CSSProperties}
                >
                  {summary}
                </div>
              )}
              {link && (
                <a
                  href={link}
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
                >
                  View source <ExternalLink size={10} />
                </a>
              )}
            </div>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                minWidth: '22px',
                height: '22px',
                borderRadius: '11px',
                background: 'var(--sia-navy)',
                color: '#fff',
                fontSize: '10px',
                fontWeight: 700,
                flexShrink: 0,
                marginTop: '1px',
              }}
            >
              {num}
            </span>
          </div>
        )
      })}
    </div>
  )
}

// ─── Shared source card ────────────────────────────────────────────────────────
interface SourceCardProps {
  num: string
  icon: React.ReactNode
  name: string
  summary?: string | null
  link: string | null
  badgeLabel: string
  badgeBg: string
  badgeFg: string
  active: boolean
  refCallback: (el: HTMLDivElement | null) => void
}

function SourceCard({ num, icon, name, summary, link, badgeLabel, badgeBg, badgeFg, active, refCallback }: SourceCardProps) {
  return (
    <div
      ref={refCallback}
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: '10px',
        padding: '12px 16px',
        borderBottom: '1px solid rgba(69,85,105,0.08)',
        background: active ? 'rgba(0,152,121,0.05)' : '#fff',
        transition: 'background 0.15s',
      }}
    >
      {icon}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontWeight: 700,
            fontSize: '13px',
            color: 'var(--sia-navy)',
            marginBottom: '4px',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={name}
        >
          {name}
        </div>
        {summary && (
          <div
            style={{
              fontSize: '11px',
              color: 'var(--sia-cool-gray)',
              marginBottom: '6px',
              overflow: 'hidden',
              display: '-webkit-box',
              WebkitLineClamp: 3,
              WebkitBoxOrient: 'vertical',
              lineHeight: '1.45',
            } as React.CSSProperties}
          >
            {summary}
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <span
            style={{
              fontSize: '10px',
              fontWeight: 600,
              padding: '2px 7px',
              borderRadius: '4px',
              background: badgeBg,
              color: badgeFg,
              letterSpacing: '0.3px',
            }}
          >
            {badgeLabel}
          </span>
          {link && (
            <a
              href={link}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                fontSize: '11px',
                color: 'var(--sia-teal)',
                display: 'flex',
                alignItems: 'center',
                gap: '3px',
                textDecoration: 'none',
                fontWeight: 500,
              }}
            >
              View source <ExternalLink size={10} />
            </a>
          )}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '2px', flexShrink: 0, marginTop: '1px' }}>
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            minWidth: '24px',
            height: '24px',
            borderRadius: '12px',
            background: 'var(--sia-navy)',
            color: '#fff',
            fontSize: '11px',
            fontWeight: 700,
          }}
        >
          {num}
        </span>
        <ChevronRight size={12} color="var(--sia-cool-gray)" />
      </div>
    </div>
  )
}
