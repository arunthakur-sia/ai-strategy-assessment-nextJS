'use client'
import React from 'react'
import { Building2, Layers, ChevronDown } from 'lucide-react'
import { useStore } from '@/store/useStore'

interface Props {
  /** Optional note text shown below the entity row, e.g. "Strategy is shared across all entities" */
  note?: string
  /** If true, show a compact inline switcher instead of the full dropdown row */
  compact?: boolean
}

function entityCompletion(entity: any): number {
  const pillars = Object.values(entity.assessment?.pillars || {})
  if (!pillars.length) return 0
  return Math.round(((pillars as any[]).filter((p: any) => p.status === 'complete').length / pillars.length) * 100)
}

function entityScore(entity: any): string | null {
  const pillars = Object.values(entity.assessment?.pillars || {})
  const scored = (pillars as any[]).filter((p: any) => p.finalScore !== null)
  if (!scored.length) return null
  return (scored.reduce((s: number, p: any) => s + (p.finalScore || 0), 0) / scored.length).toFixed(1)
}

/**
 * EntityBanner — renders an entity context bar at the top of any page.
 * Shows which entity is currently being viewed and provides in-page entity switching.
 * Only renders if the project has subsidiary entities.
 */
export default function EntityBanner({ note, compact = false }: Props) {
  const { project, activeEntityId, setActiveEntityId } = useStore()

  if (!project) return null
  const entities = project.entities || []
  if (entities.length === 0) return null

  const activeEntity = activeEntityId ? entities.find((e: any) => e.id === activeEntityId) : null
  const isMain = !activeEntityId
  const displayName = activeEntity ? activeEntity.name : project.entityName
  const displayType = activeEntity ? activeEntity.type : project.entityType
  const score = activeEntity ? entityScore(activeEntity) : null
  const completion = activeEntity ? entityCompletion(activeEntity) : null

  const accentColor = isMain ? 'var(--sia-teal)' : '#8B5CF6'
  const accentBg = isMain ? 'rgba(0,222,204,0.06)' : 'rgba(139,92,246,0.06)'
  const accentBorder = isMain ? 'rgba(0,222,204,0.25)' : 'rgba(139,92,246,0.25)'

  return (
    <div style={{
      background: accentBg,
      border: `1px solid ${accentBorder}`,
      borderRadius: 'var(--radius)',
      padding: compact ? '10px 14px' : '14px 18px',
      marginBottom: '24px',
    }}>
      {/* Top row: entity identity + switcher pills */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
        {/* Icon + label */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1, minWidth: 0 }}>
          <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: isMain ? 'rgba(0,222,204,0.15)' : 'rgba(139,92,246,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <Building2 size={15} color={accentColor} />
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '14px', fontWeight: 700, color: 'var(--sia-navy)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {displayName}
              </span>
              <span style={{ fontSize: '10px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', color: accentColor, padding: '2px 7px', background: isMain ? 'rgba(0,222,204,0.12)' : 'rgba(139,92,246,0.12)', borderRadius: '999px' }}>
                {isMain ? 'Main Entity' : 'Subsidiary'}
              </span>
              {displayType && (
                <span style={{ fontSize: '10px', color: 'var(--sia-medium-gray)', padding: '2px 7px', background: 'rgba(69,85,105,0.08)', borderRadius: '999px' }}>
                  {displayType}
                </span>
              )}
              {score && (
                <span style={{ fontSize: '11px', fontWeight: 700, color: accentColor }}>
                  {score} / 5
                </span>
              )}
              {completion !== null && (
                <span style={{ fontSize: '11px', color: 'var(--sia-medium-gray)' }}>
                  {completion}% assessed
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Entity switcher pills */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '5px', flexShrink: 0, flexWrap: 'wrap' }}>
          <span style={{ fontSize: '10px', color: 'var(--sia-medium-gray)', marginRight: '2px', whiteSpace: 'nowrap' }}>
            <Layers size={10} style={{ display: 'inline', marginRight: '3px', verticalAlign: 'middle' }} />
            Switch:
          </span>
          {/* Main entity pill */}
          <button
            onClick={() => setActiveEntityId(null)}
            style={{
              padding: '4px 10px', borderRadius: '999px', fontSize: '11px', fontWeight: isMain ? 700 : 400,
              background: isMain ? 'rgba(0,222,204,0.15)' : 'rgba(255,255,255,0.8)',
              border: `1.5px solid ${isMain ? 'rgba(0,222,204,0.5)' : 'rgba(69,85,105,0.15)'}`,
              color: isMain ? 'var(--sia-teal)' : 'var(--sia-cool-gray)',
              cursor: 'pointer', whiteSpace: 'nowrap', transition: 'all 0.15s',
            }}
          >
            {project.entityName}
          </button>
          {entities.map((entity: any) => {
            const isActive = activeEntityId === entity.id
            return (
              <button
                key={entity.id}
                onClick={() => setActiveEntityId(entity.id)}
                style={{
                  padding: '4px 10px', borderRadius: '999px', fontSize: '11px', fontWeight: isActive ? 700 : 400,
                  background: isActive ? 'rgba(139,92,246,0.15)' : 'rgba(255,255,255,0.8)',
                  border: `1.5px solid ${isActive ? 'rgba(139,92,246,0.5)' : 'rgba(69,85,105,0.15)'}`,
                  color: isActive ? '#8B5CF6' : 'var(--sia-cool-gray)',
                  cursor: 'pointer', whiteSpace: 'nowrap', transition: 'all 0.15s',
                }}
              >
                {entity.name}
              </button>
            )
          })}
        </div>
      </div>

      {/* Optional note */}
      {note && (
        <div style={{ marginTop: '8px', fontSize: '12px', color: 'var(--sia-cool-gray)', paddingLeft: '40px', lineHeight: 1.5 }}>
          {note}
        </div>
      )}
    </div>
  )
}
