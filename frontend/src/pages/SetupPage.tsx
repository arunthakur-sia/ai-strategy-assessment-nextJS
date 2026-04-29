import React, { useState, useRef, useEffect } from 'react'
import { useStore } from '../store/useStore'
import type { SubsidiaryEntity } from '../store/useStore'
import { projectsApi, documentsApi, entitiesApi, entityDocumentsApi } from '../api'
import { Upload, Trash2, FileText, CheckCircle, Loader2, Eye, X, ChevronDown, ChevronUp, Building2, Plus, Info } from 'lucide-react'

const DOC_TYPES: Record<string, any[]> = {
  mandatory: [
    { id: 'M1', label: 'Strategy Document', desc: 'Corporate strategy, vision, mission, objectives', pillars: 'P1, P2, P4, P8', accepts: '.pdf,.pptx,.ppt' },
    { id: 'M2', label: 'Financial Statements', desc: 'P&L, Balance Sheet, Cash Flow (3-5 years)', pillars: 'P3', accepts: '.xlsx,.xls,.pdf' },
    { id: 'M3', label: 'Organizational Chart', desc: 'Current org structure, reporting lines', pillars: 'P2, P6', accepts: '.pdf,.png,.jpg,.pptx' },
  ],
  optional: [
    { id: 'O1', label: 'Board / Management Presentations', desc: 'Board decks, investor presentations', pillars: 'P1, P2, P3, P8' },
    { id: 'O2', label: 'Governance Documents', desc: 'Board charter, delegation of authority', pillars: 'P2' },
    { id: 'O3', label: 'KPI / Performance Dashboards', desc: 'Balanced scorecards, performance reviews', pillars: 'P2, P3, P5' },
    { id: 'O4', label: 'Market / Industry Reports', desc: 'Market research, competitive intelligence', pillars: 'P4' },
    { id: 'O5', label: 'HR / People Data', desc: 'Headcount, talent reviews, engagement surveys', pillars: 'P6' },
    { id: 'O6', label: 'Risk Registers / Compliance Reports', desc: 'Enterprise risk assessments, audit findings', pillars: 'P7' },
    { id: 'O7', label: 'Operational Reports', desc: 'Process docs, efficiency metrics, tech assessments', pillars: 'P5' },
    { id: 'O8', label: 'Budget / Financial Plans', desc: 'Annual budgets, financial forecasts, capex plans', pillars: 'P3, P8' },
  ],
  enrichment: [
    { id: 'E1', label: 'Annual Reports', desc: 'Published annual reports', pillars: 'P1, P3, P4' },
    { id: 'E2', label: 'ESG / Sustainability Reports', desc: 'ESG disclosures', pillars: 'P7' },
    { id: 'E3', label: 'Digital / IT Strategy', desc: 'Technology roadmaps, AI strategy', pillars: 'P5, P8' },
    { id: 'E4', label: 'M&A / Corporate Development', desc: 'Acquisition pipeline, due diligence', pillars: 'P8' },
    { id: 'E5', label: 'Customer / Stakeholder Feedback', desc: 'NPS surveys, customer satisfaction', pillars: 'P4' },
    { id: 'E6', label: 'Culture / Values Documents', desc: 'Culture assessments, employer brand', pillars: 'P6' },
    { id: 'E7', label: 'Previous Consulting Reports', desc: 'Prior strategy reviews, benchmarking studies', pillars: 'All' },
  ]
}

const TIER_CONFIG: Record<string, any> = {
  mandatory: { label: '🔴 Mandatory', color: 'var(--sia-red)', bg: '#FEF2F2', border: '#FECACA', desc: 'Assessment cannot proceed without these' },
  optional:  { label: '🟡 Optional',  color: 'var(--sia-amber)', bg: '#FFFBEB', border: '#FDE68A', desc: 'Significantly enhance assessment quality' },
  enrichment:{ label: '🟢 Enrichment', color: 'var(--sia-green)', bg: '#ECFDF5', border: '#6EE7B7', desc: 'Add depth and context' },
}

const ENTITY_TYPES = [
  { value: 'government', label: 'Government Ministry / Authority' },
  { value: 'holding', label: 'Holding Company' },
  { value: 'corporate', label: 'Corporate / Private Sector' },
  { value: 'ngo', label: 'NGO / Non-Profit' },
  { value: 'other', label: 'Other' },
]

const STRATEGY_TEMPLATES = [
  { value: 'government', label: 'Government', desc: 'Vision → Strategic Options → Outcomes → KPIs → Initiatives → Projects' },
  { value: 'corporate', label: 'Corporate', desc: 'Vision → Mission → Strategic Pillars → Objectives → KPIs → Initiatives' },
  { value: 'custom', label: 'Custom', desc: 'Define your own hierarchy (2–6 levels)' },
]

export default function SetupPage() {
  const { project, setProject } = useStore()
  const [activeTab, setActiveTab] = useState('entity')
  const [saving, setSaving] = useState(false)
  const [savedMsg, setSavedMsg] = useState('')
  const [uploading, setUploading] = useState<Record<string, boolean>>({})
  const [embeddingStatus, setEmbeddingStatus] = useState<Record<string, 'embedding' | 'complete'>>({})
  const [expandedTiers, setExpandedTiers] = useState<Record<string, boolean>>({ mandatory: true, optional: false, enrichment: false })
  const [previewDoc, setPreviewDoc] = useState<any>(null)
  const [dragOver, setDragOver] = useState<string | null>(null)
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({})

  // Entity document state
  const [entityEmbeddingStatus, setEntityEmbeddingStatus] = useState<Record<string, Record<string, 'embedding' | 'complete'>>>({}) // entityId -> docName -> status
  const [entityUploading, setEntityUploading] = useState<Record<string, boolean>>({})
  const [expandedEntityDocs, setExpandedEntityDocs] = useState<Set<string>>(new Set())
  const [addingEntity, setAddingEntity] = useState(false)
  const [showAddEntityForm, setShowAddEntityForm] = useState(false)
  const [newEntityName, setNewEntityName] = useState('')
  const [newEntityType, setNewEntityType] = useState('corporate')

  if (!project) return null

  const hasEmbedding = Object.values(embeddingStatus).some(v => v === 'embedding')
  const hasEntityEmbedding = Object.values(entityEmbeddingStatus).some(m => Object.values(m).some(v => v === 'embedding'))

  // Poll SiaGPT embedding completion while any doc is being processed
  useEffect(() => {
    if (!hasEmbedding) return
    let cancelled = false
    const poll = async () => {
      if (cancelled) return
      try {
        const res = await documentsApi.embeddingStatus(project!.id)
        const serverStatus = res.data.status as Record<string, number>
        if (!cancelled) {
          setEmbeddingStatus(prev => {
            const next = { ...prev }
            for (const [name, completion] of Object.entries(serverStatus)) {
              if (prev[name] === 'embedding' && completion >= 1.0) next[name] = 'complete'
            }
            return next
          })
        }
      } catch (e) {}
    }
    const id = setInterval(poll, 3000)
    return () => { cancelled = true; clearInterval(id) }
  }, [hasEmbedding, project!.id])

  // Poll SiaGPT embedding completion for entity documents
  useEffect(() => {
    if (!hasEntityEmbedding) return
    let cancelled = false
    const poll = async () => {
      if (cancelled) return
      try {
        const currentEntities: SubsidiaryEntity[] = (project as any).entities || []
        for (const entity of currentEntities) {
          const entityStatus = entityEmbeddingStatus[entity.id] || {}
          if (!Object.values(entityStatus).some(v => v === 'embedding')) continue
          const res = await entityDocumentsApi.embeddingStatus(project!.id, entity.id)
          const serverStatus = res.data.status as Record<string, number>
          if (!cancelled) {
            setEntityEmbeddingStatus(prev => {
              const next = { ...prev, [entity.id]: { ...(prev[entity.id] || {}) } }
              for (const [name, completion] of Object.entries(serverStatus)) {
                if (prev[entity.id]?.[name] === 'embedding' && completion >= 1.0) {
                  next[entity.id][name] = 'complete'
                }
              }
              return next
            })
          }
        }
      } catch (e) {}
    }
    const id = setInterval(poll, 3000)
    return () => { cancelled = true; clearInterval(id) }
  }, [hasEntityEmbedding, project!.id])

  async function saveField(field: string, value: any) {
    setSaving(true)
    try {
      const updated = { ...project, [field]: value }
      await projectsApi.save(project!.id, { [field]: value })
      setProject(updated as any)
      setSavedMsg('Saved')
      setTimeout(() => setSavedMsg(''), 2000)
    } catch (e) {}
    setSaving(false)
  }

  async function handleUpload(files: FileList | null, docType: string) {
    if (!files || files.length === 0) return
    const fileArr = Array.from(files)
    setUploading(u => ({ ...u, [docType]: true }))
    try {
      await documentsApi.upload(project!.id, fileArr, docType, docType)
      // Mark uploaded files as 'embedding' — polling will update to 'complete'
      setEmbeddingStatus(prev => {
        const next = { ...prev }
        fileArr.forEach(f => { next[f.name] = 'embedding' })
        return next
      })
      const updated = await projectsApi.get(project!.id)
      setProject(updated.data)
    } catch (e: any) {
      alert('Upload failed: ' + (e.response?.data?.error || e.message))
    }
    setUploading(u => ({ ...u, [docType]: false }))
  }

  async function handleDeleteDoc(docId: string) {
    if (!confirm('Remove this document?')) return
    await documentsApi.delete(project!.id, docId)
    const updated = await projectsApi.get(project!.id)
    setProject(updated.data)
  }

  function getDocsForType(typeId: string) {
    return project!.documents.filter((d: any) => d.type === typeId)
  }

  const entities: SubsidiaryEntity[] = project.entities || []

  async function handleEntityUpload(entityId: string, files: FileList | null) {
    if (!files || files.length === 0) return
    const fileArr = Array.from(files)
    setEntityUploading(u => ({ ...u, [entityId]: true }))
    try {
      await entityDocumentsApi.upload(project!.id, entityId, fileArr, 'general', 'general')
      setEntityEmbeddingStatus(prev => {
        const next = { ...prev, [entityId]: { ...(prev[entityId] || {}) } }
        fileArr.forEach(f => { next[entityId][f.name] = 'embedding' })
        return next
      })
      const updated = await projectsApi.get(project!.id)
      setProject(updated.data)
    } catch (e: any) {
      alert('Upload failed: ' + (e.response?.data?.error || e.message))
    }
    setEntityUploading(u => ({ ...u, [entityId]: false }))
  }

  async function handleEntityDeleteDoc(entityId: string, docId: string) {
    if (!confirm('Remove this document?')) return
    await entityDocumentsApi.delete(project!.id, entityId, docId)
    const updated = await projectsApi.get(project!.id)
    setProject(updated.data)
  }

  async function handleAddEntity() {
    if (!newEntityName.trim()) return
    setAddingEntity(true)
    try {
      await entitiesApi.add(project!.id, { name: newEntityName.trim(), type: newEntityType })
      const updated = await projectsApi.get(project!.id)
      setProject(updated.data)
      setNewEntityName('')
      setNewEntityType('corporate')
      setShowAddEntityForm(false)
    } catch (e: any) {
      alert('Failed to add entity: ' + (e.response?.data?.error || e.message))
    }
    setAddingEntity(false)
  }

  async function handleRemoveEntity(entityId: string, entityName: string) {
    if (!confirm(`Remove entity "${entityName}"? This will delete all its documents and assessment data.`)) return
    try {
      await entitiesApi.remove(project!.id, entityId)
      const updated = await projectsApi.get(project!.id)
      setProject(updated.data)
    } catch (e: any) {
      alert('Failed to remove entity: ' + e.message)
    }
  }

  const tabs = [
    { id: 'entity', label: 'Entity Info' },
    { id: 'documents', label: `Documents (${project.documents.length})` },
    { id: 'entities', label: `Portfolio Entities (${entities.length})` },
    { id: 'config', label: 'Configuration' },
  ]

  return (
    <div style={{ padding: '32px', maxWidth: '960px' }}>
      <div style={{ marginBottom: '28px' }}>
        <div style={{ fontSize: '12px', color: 'var(--sia-medium-gray)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '6px', fontWeight: 600 }}>Project Setup</div>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '28px', fontWeight: 800, color: 'var(--sia-navy)' }}>Configure Your Assessment</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '6px' }}>
          {saving && <><Loader2 size={13} color="var(--sia-teal)" className="spinner" /><span style={{ fontSize: '13px', color: 'var(--sia-medium-gray)' }}>Saving...</span></>}
          {savedMsg && <><CheckCircle size={13} color="var(--sia-green)" /><span style={{ fontSize: '13px', color: 'var(--sia-green)' }}>{savedMsg}</span></>}
        </div>
      </div>

      <div className="tabs" style={{ maxWidth: '400px', marginBottom: '28px' }}>
        {tabs.map(t => (
          <button key={t.id} className={`tab-btn ${activeTab === t.id ? 'active' : ''}`} data-testid={`tab-${t.id}`} onClick={() => setActiveTab(t.id)}>{t.label}</button>
        ))}
      </div>

      {activeTab === 'entity' && (
        <div className="card" style={{ padding: '28px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
            {[
              { field: 'entityName', label: 'Entity Name', placeholder: 'e.g. Ministry of Commerce and Industry' },
              { field: 'name', label: 'Project Name', placeholder: 'e.g. MOCI Strategy Assessment 2025' },
              { field: 'consultantName', label: 'Lead Consultant', placeholder: 'Your name' },
              { field: 'sector', label: 'Sector / Industry', placeholder: 'e.g. Government, Financial Services' },
              { field: 'assessmentDateStart', label: 'Assessment Start Date', type: 'date' },
              { field: 'assessmentDateEnd', label: 'Assessment End Date', type: 'date' },
            ].map(f => (
              <div key={f.field} className="form-group">
                <label className="form-label">{f.label}</label>
                <input className="form-input" data-testid={`input-${f.field}`} type={f.type || 'text'} placeholder={f.placeholder}
                  defaultValue={(project as any)[f.field] || ''}
                  onBlur={e => { if (e.target.value !== ((project as any)[f.field] || '')) saveField(f.field, e.target.value) }}
                />
              </div>
            ))}

            <div className="form-group">
              <label className="form-label">Entity Type</label>
              <select className="form-input form-select" data-testid="select-entity-type" defaultValue={project.entityType}
                onChange={e => saveField('entityType', e.target.value)}>
                {ENTITY_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">Display Language</label>
              <select className="form-input form-select" data-testid="select-language" defaultValue={project.language}
                onChange={e => saveField('language', e.target.value)}>
                <option value="en">English</option>
                <option value="ar">Arabic / العربية</option>
              </select>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'documents' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {entities.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', padding: '14px 18px', background: 'rgba(0,222,204,0.05)', border: '1px solid rgba(0,222,204,0.2)', borderRadius: 'var(--radius)' }}>
              <Info size={15} color="var(--sia-teal)" style={{ flexShrink: 0, marginTop: '1px' }} />
              <div style={{ fontSize: '13px', color: 'var(--sia-cool-gray)', lineHeight: 1.6 }}>
                <strong style={{ color: 'var(--sia-navy)' }}>Main entity documents</strong> — these documents are scoped to <strong>{project.entityName}</strong>.
                {' '}To manage documents for subsidiary entities (<strong>{entities.map((e: any) => e.name).join(', ')}</strong>), switch to the{' '}
                <button onClick={() => setActiveTab('entities')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--sia-teal)', fontWeight: 600, padding: 0, fontSize: '13px', textDecoration: 'underline' }}>Entities tab</button>.
              </div>
            </div>
          )}
          <div className="card" style={{ padding: '24px' }}>
            <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--sia-navy)', marginBottom: '12px' }}>Quick Upload</div>
            <div
              onDragOver={e => { e.preventDefault(); setDragOver('general') }}
              onDragLeave={() => setDragOver(null)}
              onDrop={e => { e.preventDefault(); setDragOver(null); handleUpload(e.dataTransfer.files, 'general') }}
              style={{ border: `2px dashed ${dragOver === 'general' ? 'var(--sia-teal)' : 'rgba(69,85,105,0.2)'}`, borderRadius: 'var(--radius-lg)', padding: '32px', textAlign: 'center', background: dragOver === 'general' ? 'rgba(0,222,204,0.04)' : 'transparent', transition: 'all 0.15s', cursor: 'pointer' }}
              onClick={() => { const i = document.createElement('input'); i.type='file'; i.multiple=true; i.accept='.pdf,.docx,.xlsx,.pptx,.png,.jpg'; i.onchange=e=>handleUpload((e.target as HTMLInputElement).files,'general'); i.click() }}
            >
              <Upload size={28} color={dragOver === 'general' ? 'var(--sia-teal)' : 'var(--sia-medium-gray)'} style={{ margin: '0 auto 12px' }} />
              <div style={{ fontSize: '14px', fontWeight: 500, color: 'var(--sia-cool-gray)' }}>Drop any document here or click to browse</div>
              <div style={{ fontSize: '12px', color: 'var(--sia-medium-gray)', marginTop: '4px' }}>PDF, DOCX, XLSX, PPTX, PNG, JPG — max 50MB each</div>
            </div>
          </div>

          {project.documents.length > 0 && (
            <div className="card" style={{ padding: '24px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--sia-navy)' }}>Uploaded Documents</div>
                  <span style={{ fontSize: '12px', padding: '2px 10px', borderRadius: '999px', background: 'rgba(0,222,204,0.1)', color: 'var(--sia-teal)', fontWeight: 600 }}>
                    {project.documents.length} file{project.documents.length !== 1 ? 's' : ''}
                  </span>
                  {Object.values(embeddingStatus).some(v => v === 'embedding') && (
                    <span style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', color: '#D97706', fontWeight: 600 }}>
                      <Loader2 size={11} className="spinner" /> Processing...
                    </span>
                  )}
                </div>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => {
                    const i = document.createElement('input')
                    i.type = 'file'; i.multiple = true
                    i.accept = '.pdf,.docx,.xlsx,.pptx,.png,.jpg'
                    i.onchange = e => handleUpload((e.target as HTMLInputElement).files, 'general')
                    i.click()
                  }}
                >
                  <Upload size={12} /> Add More
                </button>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {project.documents.map((doc: any) => {
                  const isEmbedding = embeddingStatus[doc.name] === 'embedding'
                  const isEmbedded = embeddingStatus[doc.name] === 'complete'
                  return (
                    <div key={doc.id} style={{
                      display: 'flex', alignItems: 'center', gap: '10px',
                      padding: '10px 14px',
                      background: isEmbedding ? 'rgba(245,158,11,0.05)' : isEmbedded ? '#F0FDF4' : 'var(--sia-light-gray)',
                      border: `1px solid ${isEmbedding ? 'rgba(245,158,11,0.3)' : isEmbedded ? '#6EE7B7' : 'rgba(69,85,105,0.1)'}`,
                      borderRadius: 'var(--radius)', transition: 'all 0.2s'
                    }}>
                      <div style={{
                        width: '32px', height: '32px', borderRadius: '6px', flexShrink: 0,
                        background: isEmbedded ? '#D1FAE5' : isEmbedding ? 'rgba(245,158,11,0.1)' : 'white',
                        border: `1px solid ${isEmbedded ? '#6EE7B7' : isEmbedding ? 'rgba(245,158,11,0.3)' : 'rgba(69,85,105,0.15)'}`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center'
                      }}>
                        {isEmbedding
                          ? <Loader2 size={14} color="#D97706" className="spinner" />
                          : isEmbedded
                            ? <CheckCircle size={14} color="var(--sia-green)" />
                            : <FileText size={14} color="var(--sia-medium-gray)" />}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--sia-navy)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{doc.name}</div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '2px', flexWrap: 'wrap' }}>
                          {doc.type && doc.type !== 'general' && (
                            <span style={{ fontSize: '11px', padding: '1px 6px', borderRadius: '4px', background: 'rgba(25,71,125,0.08)', color: 'var(--sia-navy)', fontWeight: 600 }}>{doc.type}</span>
                          )}
                          {doc.wordCount > 0 && (
                            <span style={{ fontSize: '11px', color: 'var(--sia-medium-gray)' }}>{doc.wordCount.toLocaleString()} words</span>
                          )}
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
                        {isEmbedding && (
                          <span style={{ display: 'flex', alignItems: 'center', gap: '3px', fontSize: '11px', color: '#D97706', fontWeight: 600 }}>
                            <Loader2 size={10} className="spinner" /> Processing
                          </span>
                        )}
                        {isEmbedded && (
                          <span style={{ display: 'flex', alignItems: 'center', gap: '3px', fontSize: '11px', color: 'var(--sia-green)', fontWeight: 600 }}>
                            <CheckCircle size={10} /> Ready
                          </span>
                        )}
                        <button
                          title="Preview document"
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--sia-cool-gray)', padding: '4px', display: 'flex', borderRadius: '4px' }}
                          onClick={() => setPreviewDoc(doc)}
                        >
                          <Eye size={13} />
                        </button>
                        <button
                          title="Remove document"
                          data-testid={`button-delete-doc-list-${doc.id}`}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--sia-red)', padding: '4px', display: 'flex', borderRadius: '4px' }}
                          onClick={() => handleDeleteDoc(doc.id)}
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', padding: '14px 18px', background: 'rgba(25,71,125,0.04)', border: '1px solid rgba(25,71,125,0.12)', borderRadius: 'var(--radius)' }}>
            <Info size={15} color="var(--sia-navy)" style={{ flexShrink: 0, marginTop: '1px' }} />
            <div style={{ fontSize: '13px', color: 'var(--sia-cool-gray)', lineHeight: 1.6 }}>
              <strong style={{ color: 'var(--sia-navy)' }}>These are suggested document types to guide your upload.</strong>
              {' '}You are not limited to these — upload any document that may be relevant to the assessment.
              All uploaded documents go into the same shared collection and are available to the assessment engine.
            </div>
          </div>

          {Object.entries(DOC_TYPES).map(([tier, docs]) => {
            const cfg = TIER_CONFIG[tier]
            const expanded = expandedTiers[tier]
            const uploadedCount = docs.filter(d => getDocsForType(d.id).length > 0).length
            return (
              <div key={tier} className="card" style={{ overflow: 'hidden' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', cursor: 'pointer', borderBottom: expanded ? '1px solid rgba(69,85,105,0.08)' : 'none' }}
                  onClick={() => setExpandedTiers(t => ({ ...t, [tier]: !t[tier] }))}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <span style={{ fontSize: '15px', fontWeight: 700, color: 'var(--sia-navy)' }}>{cfg.label}</span>
                    <span style={{ fontSize: '12px', padding: '2px 10px', borderRadius: '999px', background: cfg.bg, border: `1px solid ${cfg.border}`, color: cfg.color, fontWeight: 600 }}>{uploadedCount}/{docs.length} uploaded</span>
                    <span style={{ fontSize: '12px', color: 'var(--sia-medium-gray)' }}>{cfg.desc}</span>
                  </div>
                  {expanded ? <ChevronUp size={16} color="var(--sia-medium-gray)" /> : <ChevronDown size={16} color="var(--sia-medium-gray)" />}
                </div>

                {expanded && (
                  <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    {docs.map(docDef => {
                      const uploaded = getDocsForType(docDef.id)
                      const isUploading = uploading[docDef.id]
                      return (
                        <div key={docDef.id} style={{ display: 'flex', alignItems: 'flex-start', gap: '16px', padding: '14px', background: uploaded.length > 0 ? '#F0FDF4' : 'var(--sia-light-gray)', border: `1px solid ${uploaded.length > 0 ? '#6EE7B7' : 'rgba(69,85,105,0.1)'}`, borderRadius: 'var(--radius)' }}>
                          <div style={{ width: '36px', height: '36px', borderRadius: '8px', background: uploaded.length > 0 ? '#D1FAE5' : 'white', border: `1px solid ${uploaded.length > 0 ? '#6EE7B7' : 'rgba(69,85,105,0.15)'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                            {uploaded.length > 0 ? <CheckCircle size={16} color="var(--sia-green)" /> : <FileText size={16} color="var(--sia-medium-gray)" />}
                          </div>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--sia-navy)', marginBottom: '2px' }}>{docDef.id} — {docDef.label}</div>
                            <div style={{ fontSize: '12px', color: 'var(--sia-cool-gray)', marginBottom: '2px' }}>{docDef.desc}</div>
                            <div style={{ fontSize: '11px', color: 'var(--sia-medium-gray)' }}>Feeds: {docDef.pillars}</div>
                            {uploaded.map((doc: any) => (
                              <div key={doc.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '6px', padding: '6px 10px', background: 'white', borderRadius: '6px', border: '1px solid rgba(16,185,129,0.2)' }}>
                                <FileText size={12} color="var(--sia-green)" />
                                <span style={{ fontSize: '12px', color: 'var(--sia-cool-gray)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{doc.name}</span>
                                <span style={{ fontSize: '11px', color: 'var(--sia-medium-gray)' }}>{doc.wordCount?.toLocaleString()} words</span>
                                {embeddingStatus[doc.name] === 'embedding' && (
                                  <span style={{ display: 'flex', alignItems: 'center', gap: '3px', fontSize: '11px', color: 'var(--sia-teal)', fontWeight: 600, flexShrink: 0 }}>
                                    <Loader2 size={10} className="spinner" /> Embedding...
                                  </span>
                                )}
                                {embeddingStatus[doc.name] === 'complete' && (
                                  <span style={{ display: 'flex', alignItems: 'center', gap: '3px', fontSize: '11px', color: 'var(--sia-green)', fontWeight: 600, flexShrink: 0 }}>
                                    <CheckCircle size={10} /> Embedded
                                  </span>
                                )}
                                <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--sia-medium-gray)', padding: '2px', display: 'flex' }} onClick={() => setPreviewDoc(doc)}>
                                  <Eye size={13} />
                                </button>
                                <button data-testid={`button-delete-doc-${doc.id}`} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--sia-red)', padding: '2px', display: 'flex' }} onClick={() => handleDeleteDoc(doc.id)}>
                                  <Trash2 size={13} />
                                </button>
                              </div>
                            ))}
                          </div>
                          <div
                            onDragOver={e => { e.preventDefault(); setDragOver(docDef.id) }}
                            onDragLeave={() => setDragOver(null)}
                            onDrop={e => { e.preventDefault(); setDragOver(null); handleUpload(e.dataTransfer.files, 'general') }}
                            style={{ flexShrink: 0 }}
                          >
                            <input ref={el => fileInputRefs.current[docDef.id] = el} type="file" multiple style={{ display: 'none' }} onChange={e => handleUpload(e.target.files, 'general')} />
                            <button className="btn btn-ghost btn-sm" data-testid={`button-upload-${docDef.id}`} disabled={isUploading}
                              onClick={() => fileInputRefs.current[docDef.id]?.click()}>
                              {isUploading ? <Loader2 size={12} className="spinner" /> : <Upload size={12} />}
                              {isUploading ? 'Uploading...' : 'Upload'}
                            </button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {activeTab === 'entities' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div className="card" style={{ padding: '20px 24px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <Building2 size={16} color="var(--sia-teal)" />
                <span style={{ fontSize: '15px', fontWeight: 700, color: 'var(--sia-navy)', fontFamily: 'var(--font-display)' }}>Subsidiary Entities</span>
                <span style={{ fontSize: '12px', padding: '2px 10px', borderRadius: '999px', background: 'rgba(0,222,204,0.1)', color: 'var(--sia-teal)', fontWeight: 700 }}>{entities.length}</span>
              </div>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowAddEntityForm(v => !v)}>
                <Plus size={12} /> Add Entity
              </button>
            </div>
            <div style={{ fontSize: '13px', color: 'var(--sia-medium-gray)' }}>Each entity has its own SiaGPT document collection and assessment. Upload documents per entity to scope RAG retrieval.</div>
          </div>

          {showAddEntityForm && (
            <div className="card" style={{ padding: '18px 24px', border: '1px solid rgba(0,222,204,0.25)' }}>
              <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--sia-navy)', marginBottom: '12px' }}>Add New Entity</div>
              <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-end' }}>
                <div style={{ flex: 1 }}>
                  <label className="form-label">Entity Name</label>
                  <input className="form-input" placeholder="e.g. Subsidiary Name" value={newEntityName}
                    onChange={e => setNewEntityName(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleAddEntity()} />
                </div>
                <div style={{ width: '200px' }}>
                  <label className="form-label">Type</label>
                  <select className="form-input form-select" value={newEntityType} onChange={e => setNewEntityType(e.target.value)}>
                    {ENTITY_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </div>
                <button className="btn btn-primary btn-sm" onClick={handleAddEntity} disabled={addingEntity || !newEntityName.trim()}>
                  {addingEntity ? <Loader2 size={12} className="spinner" /> : <Plus size={12} />} Add
                </button>
                <button className="btn btn-ghost btn-sm" onClick={() => { setShowAddEntityForm(false); setNewEntityName('') }}>Cancel</button>
              </div>
            </div>
          )}

          {entities.length === 0 ? (
            <div className="card" style={{ padding: '40px', textAlign: 'center' }}>
              <Building2 size={36} color="rgba(135,150,169,0.3)" style={{ margin: '0 auto 12px' }} />
              <p style={{ fontSize: '13px', color: 'var(--sia-medium-gray)' }}>No subsidiary entities yet.</p>
              <button className="btn btn-ghost btn-sm" style={{ marginTop: '12px' }} onClick={() => setShowAddEntityForm(true)}>
                <Plus size={12} /> Add First Entity
              </button>
            </div>
          ) : (
            entities.map(entity => {
              const isExpanded = expandedEntityDocs.has(entity.id)
              const isUploading = entityUploading[entity.id]
              const entityStatus = entityEmbeddingStatus[entity.id] || {}
              return (
                <div key={entity.id} className="card" style={{ overflow: 'hidden' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 20px', cursor: 'pointer', borderBottom: isExpanded ? '1px solid rgba(69,85,105,0.08)' : 'none' }}
                    onClick={() => setExpandedEntityDocs(prev => { const next = new Set(prev); next.has(entity.id) ? next.delete(entity.id) : next.add(entity.id); return next })}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <Building2 size={15} color="var(--sia-teal)" />
                      <div>
                        <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--sia-navy)' }}>{entity.name}</div>
                        <div style={{ fontSize: '12px', color: 'var(--sia-medium-gray)' }}>{ENTITY_TYPES.find(t => t.value === entity.type)?.label || entity.type}</div>
                      </div>
                      <span style={{ fontSize: '12px', padding: '2px 8px', borderRadius: '999px', background: entity.documents.length > 0 ? 'rgba(0,222,204,0.1)' : 'rgba(69,85,105,0.08)', color: entity.documents.length > 0 ? 'var(--sia-teal)' : 'var(--sia-medium-gray)', fontWeight: 600 }}>
                        {entity.documents.length} doc{entity.documents.length !== 1 ? 's' : ''}
                      </span>
                      {entity.siagptCollectionId && (
                        <span style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '999px', background: 'rgba(25,71,125,0.08)', color: 'var(--sia-navy)', fontWeight: 600 }}>Collection linked</span>
                      )}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <button className="btn btn-ghost btn-sm" style={{ color: 'var(--sia-red)', borderColor: 'transparent' }}
                        onClick={e => { e.stopPropagation(); handleRemoveEntity(entity.id, entity.name) }}>
                        <Trash2 size={12} />
                      </button>
                      {isExpanded ? <ChevronUp size={15} color="var(--sia-medium-gray)" /> : <ChevronDown size={15} color="var(--sia-medium-gray)" />}
                    </div>
                  </div>

                  {isExpanded && (
                    <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                      {/* Drop zone */}
                      <div
                        onDragOver={e => { e.preventDefault(); setDragOver(entity.id) }}
                        onDragLeave={() => setDragOver(null)}
                        onDrop={e => { e.preventDefault(); setDragOver(null); handleEntityUpload(entity.id, e.dataTransfer.files) }}
                        style={{ border: `2px dashed ${dragOver === entity.id ? 'var(--sia-teal)' : 'rgba(69,85,105,0.2)'}`, borderRadius: 'var(--radius-lg)', padding: '24px', textAlign: 'center', background: dragOver === entity.id ? 'rgba(0,222,204,0.04)' : 'transparent', transition: 'all 0.15s', cursor: 'pointer' }}
                        onClick={() => { const i = document.createElement('input'); i.type='file'; i.multiple=true; i.accept='.pdf,.docx,.xlsx,.pptx,.png,.jpg'; i.onchange=e=>handleEntityUpload(entity.id,(e.target as HTMLInputElement).files); i.click() }}>
                        {isUploading
                          ? <><Loader2 size={22} color="var(--sia-teal)" className="spinner" style={{ margin: '0 auto 8px' }} /><div style={{ fontSize: '13px', color: 'var(--sia-teal)', fontWeight: 600 }}>Uploading...</div></>
                          : <><Upload size={22} color={dragOver === entity.id ? 'var(--sia-teal)' : 'var(--sia-medium-gray)'} style={{ margin: '0 auto 8px' }} />
                            <div style={{ fontSize: '13px', color: 'var(--sia-cool-gray)' }}>Drop documents for <strong>{entity.name}</strong> here, or click to browse</div>
                            <div style={{ fontSize: '11px', color: 'var(--sia-medium-gray)', marginTop: '4px' }}>PDF, DOCX, XLSX, PPTX, PNG, JPG — max 50MB each</div></>
                        }
                      </div>

                      {/* Uploaded docs */}
                      {entity.documents.length > 0 && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                          {entity.documents.map((doc: any) => {
                            const isEmbedding = entityStatus[doc.name] === 'embedding'
                            const isEmbedded = entityStatus[doc.name] === 'complete'
                            return (
                              <div key={doc.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 14px', background: isEmbedded ? '#F0FDF4' : isEmbedding ? 'rgba(245,158,11,0.05)' : 'var(--sia-light-gray)', border: `1px solid ${isEmbedded ? '#6EE7B7' : isEmbedding ? 'rgba(245,158,11,0.3)' : 'rgba(69,85,105,0.1)'}`, borderRadius: 'var(--radius)' }}>
                                <div style={{ width: '30px', height: '30px', borderRadius: '6px', flexShrink: 0, background: isEmbedded ? '#D1FAE5' : 'white', border: `1px solid ${isEmbedded ? '#6EE7B7' : 'rgba(69,85,105,0.15)'}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                  {isEmbedding ? <Loader2 size={13} color="#D97706" className="spinner" /> : isEmbedded ? <CheckCircle size={13} color="var(--sia-green)" /> : <FileText size={13} color="var(--sia-medium-gray)" />}
                                </div>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--sia-navy)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{doc.name}</div>
                                  {doc.wordCount > 0 && <div style={{ fontSize: '11px', color: 'var(--sia-medium-gray)' }}>{doc.wordCount.toLocaleString()} words</div>}
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
                                  {isEmbedding && <span style={{ fontSize: '11px', color: '#D97706', fontWeight: 600 }}>Processing...</span>}
                                  {isEmbedded && <span style={{ fontSize: '11px', color: 'var(--sia-green)', fontWeight: 600 }}>Embedded</span>}
                                  <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--sia-cool-gray)', padding: '3px', display: 'flex' }} onClick={() => setPreviewDoc(doc)}><Eye size={13} /></button>
                                  <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--sia-red)', padding: '3px', display: 'flex' }} onClick={() => handleEntityDeleteDoc(entity.id, doc.id)}><Trash2 size={13} /></button>
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })
          )}
        </div>
      )}

      {activeTab === 'config' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div className="card" style={{ padding: '24px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontSize: '15px', fontWeight: 600, color: 'var(--sia-navy)', marginBottom: '4px' }}>Web Search Enrichment</div>
                <div style={{ fontSize: '13px', color: 'var(--sia-cool-gray)', maxWidth: '500px' }}>When enabled, the AI will search for industry benchmarks and market data to enrich each pillar assessment with external context.</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ fontSize: '13px', color: project.webEnrichmentEnabled ? 'var(--sia-teal)' : 'var(--sia-medium-gray)', fontWeight: 600 }}>{project.webEnrichmentEnabled ? 'ON' : 'OFF'}</span>
                <button data-testid="toggle-web-enrichment" onClick={() => saveField('webEnrichmentEnabled', !project.webEnrichmentEnabled)}
                  style={{ width: '48px', height: '26px', borderRadius: '13px', border: 'none', cursor: 'pointer', background: project.webEnrichmentEnabled ? 'var(--sia-teal)' : 'rgba(69,85,105,0.2)', position: 'relative', transition: 'background 0.2s' }}>
                  <div style={{ width: '20px', height: '20px', borderRadius: '50%', background: 'white', position: 'absolute', top: '3px', left: project.webEnrichmentEnabled ? '25px' : '3px', transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)' }} />
                </button>
              </div>
            </div>
          </div>

          <div className="card" style={{ padding: '24px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontSize: '15px', fontWeight: 600, color: 'var(--sia-navy)', marginBottom: '4px' }}>Stakeholder Interview Mode</div>
                <div style={{ fontSize: '13px', color: 'var(--sia-cool-gray)', maxWidth: '500px' }}>Adds an interview score input field to each pillar element. Final score = weighted average of AI score + manual override + interview score.</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ fontSize: '13px', color: project.interviewModeEnabled ? 'var(--sia-teal)' : 'var(--sia-medium-gray)', fontWeight: 600 }}>{project.interviewModeEnabled ? 'ON' : 'OFF'}</span>
                <button data-testid="toggle-interview-mode" onClick={() => saveField('interviewModeEnabled', !project.interviewModeEnabled)}
                  style={{ width: '48px', height: '26px', borderRadius: '13px', border: 'none', cursor: 'pointer', background: project.interviewModeEnabled ? 'var(--sia-teal)' : 'rgba(69,85,105,0.2)', position: 'relative', transition: 'background 0.2s' }}>
                  <div style={{ width: '20px', height: '20px', borderRadius: '50%', background: 'white', position: 'absolute', top: '3px', left: project.interviewModeEnabled ? '25px' : '3px', transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)' }} />
                </button>
              </div>
            </div>
          </div>

          <div className="card" style={{ padding: '24px' }}>
            <div style={{ fontSize: '15px', fontWeight: 600, color: 'var(--sia-navy)', marginBottom: '16px' }}>Strategy Hierarchy Template</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {STRATEGY_TEMPLATES.map(t => (
                <div key={t.value} data-testid={`template-${t.value}`} onClick={() => saveField('strategyTemplate', t.value)}
                  style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', padding: '14px', border: `2px solid ${project.strategyTemplate === t.value ? 'var(--sia-teal)' : 'rgba(69,85,105,0.15)'}`, borderRadius: 'var(--radius)', cursor: 'pointer', background: project.strategyTemplate === t.value ? 'rgba(0,222,204,0.04)' : 'transparent', transition: 'all 0.15s' }}>
                  <div style={{ width: '18px', height: '18px', borderRadius: '50%', border: `2px solid ${project.strategyTemplate === t.value ? 'var(--sia-teal)' : 'rgba(69,85,105,0.3)'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: '2px' }}>
                    {project.strategyTemplate === t.value && <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--sia-teal)' }} />}
                  </div>
                  <div>
                    <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--sia-navy)', marginBottom: '3px' }}>{t.label}</div>
                    <div style={{ fontSize: '12px', color: 'var(--sia-cool-gray)', fontFamily: 'monospace' }}>{t.desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="card" style={{ padding: '24px' }}>
            <div style={{ fontSize: '15px', fontWeight: 600, color: 'var(--sia-navy)', marginBottom: '4px' }}>Pillar Weights for Overall Score</div>
            <div style={{ fontSize: '13px', color: 'var(--sia-cool-gray)', marginBottom: '16px' }}>Adjust relative importance of each pillar in the overall maturity score (default: all equal)</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              {Object.entries(project.assessment.pillars).map(([id, p]: [string, any]) => (
                <div key={id} style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--sia-navy)', width: '24px' }}>{id}</span>
                  <div style={{ flex: 1, fontSize: '12px', color: 'var(--sia-cool-gray)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name.split(' ').slice(0,3).join(' ')}</div>
                  <input type="number" min="0.5" max="3" step="0.5" style={{ width: '56px', padding: '4px 8px', border: '1px solid rgba(69,85,105,0.2)', borderRadius: '6px', fontSize: '12px', textAlign: 'center' }}
                    defaultValue={(project.pillarWeights as any)?.[id] || 1}
                    onBlur={e => saveField('pillarWeights', { ...(project.pillarWeights || {}), [id]: parseFloat(e.target.value) || 1 })}
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {previewDoc && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(10,21,30,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: '24px' }} onClick={() => setPreviewDoc(null)}>
          <div style={{ background: 'white', borderRadius: 'var(--radius-lg)', maxWidth: '700px', width: '100%', maxHeight: '80vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }} onClick={e => e.stopPropagation()}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid rgba(69,85,105,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--sia-navy)' }}>{previewDoc.name}</div>
                <div style={{ fontSize: '12px', color: 'var(--sia-medium-gray)' }}>{previewDoc.wordCount?.toLocaleString()} words extracted</div>
              </div>
              <button onClick={() => setPreviewDoc(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--sia-medium-gray)' }}><X size={18} /></button>
            </div>
            <div style={{ flex: 1, overflow: 'auto', padding: '20px', fontFamily: 'monospace', fontSize: '12px', lineHeight: 1.7, color: 'var(--sia-cool-gray)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              {previewDoc.extractedText?.substring(0, 5000) || 'No text extracted'}
              {previewDoc.extractedText?.length > 5000 && '\n\n[... truncated to first 5000 characters ...]'}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
