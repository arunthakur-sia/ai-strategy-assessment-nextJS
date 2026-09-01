'use client'
import React, { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Trash2, FileText, AlertTriangle, Loader2 } from 'lucide-react'
import { useStore } from '@/store/useStore'
import { projectsApi, entitiesApi } from '@/lib/api'
import { ENTITY_TYPES, wave1Total, mainEntityAdapter, wave1ApprovedCount } from '@/lib/wave1Client'

// ─── portfolio: every entity in the project (primary + subsidiaries), add/remove, click into one's workspace.
export default function DashboardPage() {
  const router = useRouter()
  const { project, setProject, setActiveEntityId } = useStore()
  const [showAdd, setShowAdd] = useState(false)
  const [name, setName] = useState('')
  const [type, setType] = useState('corporate')
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState('')

  if (!project) return null
  const projectId: string = project.id
  const entities = project.entities || []
  const mainEntity = mainEntityAdapter(project)

  async function refresh() {
    const updated = await projectsApi.get(projectId)
    setProject(updated.data)
  }

  async function addEntity() {
    if (!name.trim()) return
    setAdding(true)
    setError('')
    try {
      await entitiesApi.add(projectId, { name: name.trim(), type })
      await refresh()
      setName(''); setType('corporate'); setShowAdd(false)
    } catch (e: any) { setError(e.response?.data?.error || 'Failed to add entity.') }
    setAdding(false)
  }

  async function removeEntity(id: string, entityName: string) {
    if (!confirm(`Remove entity "${entityName}"? This deletes all its documents and assessment data.`)) return
    try {
      await entitiesApi.remove(projectId, id)
      await refresh()
    } catch (e: any) { alert('Failed to remove entity: ' + e.message) }
  }

  function openEntity(id: string) {
    setActiveEntityId(id === 'main' ? null : id)
    router.push('/assessment')
  }

  return (
    <div style={{ flex: 1, overflow: 'auto', padding: '32px', maxWidth: '1400px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px' }}>
        <div>
          <p style={{ fontSize: '20px', fontWeight: 700, margin: '0 0 4px', color: 'var(--sia-navy)', fontFamily: 'var(--font-display)' }}>Dashboard</p>
          <p style={{ fontSize: '13px', color: 'var(--sia-cool-gray)', margin: 0 }}>
            {1 + entities.length} entit{(1 + entities.length) === 1 ? 'y' : 'ies'} (the primary entity + {entities.length} subsidiar{entities.length === 1 ? 'y' : 'ies'}) running the same 4-wave methodology in parallel. Click any entity to open its assessment.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button className="btn btn-ghost" onClick={() => router.push('/setup')}><FileText size={14} /> Manage documents</button>
          <button className="btn btn-primary" onClick={() => setShowAdd(v => !v)}><Plus size={14} /> Add entity</button>
        </div>
      </div>

      {showAdd && (
        <div className="card" style={{ display: 'flex', gap: '8px', alignItems: 'flex-end', padding: '14px', marginBottom: '16px' }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '11px', color: 'var(--sia-medium-gray)', fontWeight: 600, marginBottom: '4px' }}>ENTITY NAME</div>
            <input className="form-input" placeholder="e.g. Subsidiary name" value={name}
              onChange={e => setName(e.target.value)} onKeyDown={e => e.key === 'Enter' && addEntity()} style={{ fontSize: '13px' }} />
          </div>
          <div style={{ width: '220px' }}>
            <div style={{ fontSize: '11px', color: 'var(--sia-medium-gray)', fontWeight: 600, marginBottom: '4px' }}>TYPE</div>
            <select className="form-input form-select" value={type} onChange={e => setType(e.target.value)} style={{ fontSize: '13px' }}>
              {ENTITY_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          <button className="btn btn-primary btn-sm" disabled={adding || !name.trim()} onClick={addEntity}>
            {adding ? <Loader2 size={12} className="spinner" /> : <Plus size={12} />} Add
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => { setShowAdd(false); setName(''); setError('') }}>Cancel</button>
        </div>
      )}
      {error && (
        <div style={{ padding: '10px 14px', borderRadius: 'var(--radius)', background: '#FEF2F2', border: '1px solid #FECACA', color: '#B91C1C', fontSize: '13px', marginBottom: '16px', display: 'flex', gap: '8px' }}>
          <AlertTriangle size={14} /> {error}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '14px' }}>
        {[mainEntity, ...entities].map((entity: any) => {
          const isMain = entity.id === 'main'
          const done = wave1ApprovedCount(entity)
          const total = wave1Total(entity)
          const pct = Math.round((done / total) * 100)
          return (
            <div key={entity.id} className="card" style={{ padding: '16px 18px', cursor: 'pointer', position: 'relative', border: isMain ? '1px solid rgba(0,222,204,0.3)' : undefined }} onClick={() => openEntity(entity.id)}>
              {!isMain && (
                <button
                  title="Remove entity"
                  onClick={e => { e.stopPropagation(); removeEntity(entity.id, entity.name) }}
                  style={{ position: 'absolute', top: '12px', right: '12px', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--sia-medium-gray)', padding: '3px' }}
                >
                  <Trash2 size={13} />
                </button>
              )}
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '2px', paddingRight: isMain ? 0 : '20px' }}>
                <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--sia-navy)' }}>{entity.name}</div>
                {isMain && <span style={{ fontSize: '10px', fontWeight: 700, color: 'var(--sia-teal)', background: 'rgba(0,222,204,0.12)', padding: '1px 7px', borderRadius: '999px', textTransform: 'uppercase', letterSpacing: '0.3px' }}>Primary</span>}
              </div>
              <div style={{ fontSize: '12px', color: 'var(--sia-medium-gray)', marginBottom: '10px' }}>
                {ENTITY_TYPES.find(t => t.value === entity.type)?.label || entity.type} · Diagnostic wave
              </div>
              <div className="progress-bar"><div className="progress-fill" style={{ width: `${pct}%` }} /></div>
              <div style={{ fontSize: '11.5px', color: 'var(--sia-medium-gray)', marginTop: '8px' }}>
                {done}/{total} agents approved · {entity.documents?.length || 0} doc{entity.documents?.length === 1 ? '' : 's'}
              </div>
            </div>
          )
        })}
      </div>
      {entities.length === 0 && (
        <p style={{ fontSize: '12.5px', color: 'var(--sia-medium-gray)', marginTop: '14px' }}>
          No subsidiary entities yet — add one above to run it in parallel with the primary entity.
        </p>
      )}
    </div>
  )
}
