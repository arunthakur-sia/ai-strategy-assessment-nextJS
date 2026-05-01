import React, { useState } from 'react'
import { useStore } from '../store/useStore'
import { projectsApi, aiApi } from '../api'
import { Plus, Trash2, ChevronDown, ChevronUp, Loader2, Target, Calendar } from 'lucide-react'
import EntityBanner from '../components/EntityBanner'

function uuid() { return crypto.randomUUID() }

const PRIORITY_COLORS: Record<string, any> = {
  high: { bg: '#FEF2F2', border: '#FECACA', color: '#991B1B', dot: '#EF4444' },
  medium: { bg: '#FFFBEB', border: '#FDE68A', color: '#92400E', dot: '#F59E0B' },
  low: { bg: '#F0FDF4', border: '#6EE7B7', color: '#065F46', dot: '#10B981' },
}

export default function InitiativesPage() {
  const { project, setProject, activeEntityId } = useStore()
  const [expandedObj, setExpandedObj] = useState<string | null>(null)
  const [expandedInit, setExpandedInit] = useState<string | null>(null)
  const [generating, setGenerating] = useState<string | null>(null)
  const [addingInitiative, setAddingInitiative] = useState<string | null>(null)
  const [newInitTitle, setNewInitTitle] = useState('')
  const [addingProject, setAddingProject] = useState<string | null>(null)
  const [newProjTitle, setNewProjTitle] = useState('')

  if (!project) return null

  const activeEntity = activeEntityId ? (project.entities || []).find((e: any) => e.id === activeEntityId) : null
  const strategy = activeEntity?.strategy || project.strategy
  const nodes: any[] = strategy?.nodes || []
  const levelNames = strategy?.levelNames || ['Vision','Strategic Option','Outcome','Initiative']

  const objectiveNodes = nodes.filter(n => n.level === 1)

  async function saveStrategy(newNodes: any[]) {
    if (activeEntity) {
      await projectsApi.updateEntityStrategy(project!.id, activeEntity.id, { nodes: newNodes })
    } else {
      await projectsApi.updateStrategy(project!.id, { nodes: newNodes })
    }
    const res = await projectsApi.get(project!.id)
    setProject(res.data)
  }

  async function generateInitiatives(objectiveNode: any) {
    setGenerating(objectiveNode.id)
    try {
      const res = await aiApi.generateStrategy(project!.id, 'initiatives', { objectiveTitle: objectiveNode.title, entityId: activeEntityId || undefined })
      const { initiatives } = res.data.data
      const newNodes = [...nodes]
      for (const init of (initiatives || [])) {
        newNodes.push({
          id: uuid(),
          parentId: objectiveNode.id,
          level: objectiveNode.level + 1,
          title: init.title,
          description: init.description || '',
          aiDraft: JSON.stringify(init),
          linkedPillar: null,
          kpis: [],
          initiatives: [],
          order: newNodes.filter(n => n.parentId === objectiveNode.id).length,
          meta: { owner: init.owner, startYear: init.startYear, endYear: init.endYear, priority: init.priority }
        })
      }
      await saveStrategy(newNodes)
    } catch (e: any) {
      alert('Error: ' + (e.response?.data?.error || e.message))
    }
    setGenerating(null)
  }

  async function generateProjects(initNode: any) {
    setGenerating(`proj_${initNode.id}`)
    try {
      const res = await aiApi.generateStrategy(project!.id, 'projects', { initiativeTitle: initNode.title, entityId: activeEntityId || undefined })
      const { projects } = res.data.data
      const newNodes = [...nodes]
      for (const proj of (projects || [])) {
        newNodes.push({
          id: uuid(),
          parentId: initNode.id,
          level: initNode.level + 1,
          title: proj.name,
          description: proj.description || '',
          linkedPillar: null,
          kpis: [],
          initiatives: [],
          order: newNodes.filter(n => n.parentId === initNode.id).length,
          meta: { deliveryYear: proj.deliveryYear, owner: proj.owner, source: proj.source }
        })
      }
      await saveStrategy(newNodes)
    } catch (e: any) {
      alert('Error: ' + (e.response?.data?.error || e.message))
    }
    setGenerating(null)
  }

  async function addNode(parentId: string, level: number, title: string) {
    if (!title.trim()) return
    const newNode = { id: uuid(), parentId, level, title, description: '', linkedPillar: null, kpis: [], initiatives: [], order: nodes.filter(n => n.parentId === parentId).length }
    await saveStrategy([...nodes, newNode])
    setAddingInitiative(null); setAddingProject(null)
    setNewInitTitle(''); setNewProjTitle('')
  }

  async function deleteNode(nodeId: string) {
    if (!confirm('Delete this node and all its children?')) return
    const toDelete = new Set<string>()
    const queue = [nodeId]
    while (queue.length) {
      const id = queue.shift()!
      toDelete.add(id)
      nodes.filter(n => n.parentId === id).forEach(n => queue.push(n.id))
    }
    await saveStrategy(nodes.filter(n => !toDelete.has(n.id)))
  }

  async function updateNodeField(nodeId: string, field: string, value: any) {
    const newNodes = nodes.map(n => n.id === nodeId ? { ...n, [field]: value, meta: { ...(n.meta || {}), ...((field === 'meta') ? value : {}) } } : n)
    await saveStrategy(newNodes)
  }

  const getChildren = (parentId: string) => nodes.filter(n => n.parentId === parentId).sort((a: any, b: any) => (a.order || 0) - (b.order || 0))

  if (objectiveNodes.length === 0) {
    return (
      <div style={{ padding: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
        <div style={{ textAlign: 'center', maxWidth: '400px' }}>
          <Target size={48} color="rgba(135,150,169,0.3)" style={{ margin: '0 auto 16px' }} />
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '22px', fontWeight: 700, color: 'var(--sia-navy)', marginBottom: '10px' }}>No Strategic Objectives Yet</h2>
          <p style={{ fontSize: '14px', color: 'var(--sia-cool-gray)', marginBottom: '24px' }}>Build your strategy tree in the Strategy Builder first — add L1 objectives, then come back here to define initiatives and projects.</p>
          <a href="/app/strategy" style={{ textDecoration: 'none' }}>
            <button className="btn btn-primary">Go to Strategy Builder</button>
          </a>
        </div>
      </div>
    )
  }

  return (
    <div style={{ padding: '32px', maxWidth: '1100px' }}>
      <div style={{ marginBottom: '28px' }}>
        <div style={{ fontSize: '12px', color: 'var(--sia-medium-gray)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '6px', fontWeight: 600 }}>Initiatives & Projects</div>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '28px', fontWeight: 800, color: 'var(--sia-navy)' }}>Strategic Implementation Plan</h1>
        <div style={{ fontSize: '13px', color: 'var(--sia-cool-gray)', marginTop: '6px' }}>{objectiveNodes.length} strategic objectives • {nodes.filter(n => n.level === 2).length} initiatives • {nodes.filter(n => n.level === 3).length} projects</div>
      </div>
      <EntityBanner note={activeEntity ? `Showing ${activeEntity.name}'s strategy. Switch entities in the sidebar to view another entity's initiatives.` : 'Showing the main project strategy. Select a subsidiary in the sidebar to manage its own initiatives.'} />

      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {objectiveNodes.map((obj: any) => {
          const initiatives = getChildren(obj.id)
          const isExpObj = expandedObj === obj.id
          const totalProjects = initiatives.reduce((s: number, i: any) => s + getChildren(i.id).length, 0)

          return (
            <div key={obj.id} className="card" style={{ overflow: 'hidden' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '18px 24px', cursor: 'pointer', background: isExpObj ? 'rgba(0,222,204,0.04)' : 'white', borderBottom: isExpObj ? '1px solid rgba(69,85,105,0.08)' : 'none' }}
                onClick={() => setExpandedObj(isExpObj ? null : obj.id)}>
                <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: 'var(--sia-teal)', flexShrink: 0 }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '15px', fontWeight: 700, color: 'var(--sia-navy)', marginBottom: '2px' }}>{obj.title}</div>
                  {obj.description && <div style={{ fontSize: '12px', color: 'var(--sia-cool-gray)' }}>{obj.description}</div>}
                </div>
                <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexShrink: 0 }}>
                  <span style={{ fontSize: '12px', color: 'var(--sia-medium-gray)' }}>{initiatives.length} initiatives · {totalProjects} projects</span>
                  {obj.kpis?.length > 0 && <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--sia-teal)', padding: '2px 8px', background: 'rgba(0,222,204,0.1)', borderRadius: '999px' }}>{obj.kpis.length} KPIs</span>}
                  <button className="btn btn-ghost btn-sm" data-testid={`button-gen-initiatives-${obj.id}`}
                    onClick={e => { e.stopPropagation(); generateInitiatives(obj) }} disabled={!!generating} style={{ fontSize: '11px' }}>
                    {generating === obj.id ? <Loader2 size={11} className="spinner" /> : '✨'} Generate Initiatives
                  </button>
                  {isExpObj ? <ChevronUp size={16} color="var(--sia-medium-gray)" /> : <ChevronDown size={16} color="var(--sia-medium-gray)" />}
                </div>
              </div>

              {isExpObj && (
                <div style={{ padding: '16px 24px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {initiatives.length === 0 ? (
                    <div style={{ fontSize: '13px', color: 'var(--sia-medium-gray)', fontStyle: 'italic', padding: '8px 0' }}>No initiatives yet — generate with AI or add manually</div>
                  ) : initiatives.map((init: any) => {
                    const projects = getChildren(init.id)
                    const isExpInit = expandedInit === init.id
                    const priority = init.meta?.priority
                    const pStyle = priority ? PRIORITY_COLORS[priority] : null

                    return (
                      <div key={init.id} style={{ border: '1px solid rgba(69,85,105,0.12)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 16px', background: isExpInit ? 'var(--sia-light-gray)' : 'white', cursor: 'pointer' }}
                          onClick={() => setExpandedInit(isExpInit ? null : init.id)}>
                          <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: pStyle?.dot || '#3B82F6', flexShrink: 0 }} />
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--sia-navy)' }}>{init.title}</div>
                            {init.description && <div style={{ fontSize: '12px', color: 'var(--sia-cool-gray)', marginTop: '1px' }}>{init.description}</div>}
                          </div>
                          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexShrink: 0 }}>
                            {priority && pStyle && <span style={{ fontSize: '10px', fontWeight: 600, textTransform: 'uppercase', color: pStyle.color, padding: '2px 8px', background: pStyle.bg, border: `1px solid ${pStyle.border}`, borderRadius: '999px' }}>{priority}</span>}
                            {init.meta?.startYear && <span style={{ fontSize: '11px', color: 'var(--sia-medium-gray)' }}>{init.meta.startYear}–{init.meta.endYear}</span>}
                            <span style={{ fontSize: '11px', color: 'var(--sia-medium-gray)' }}>{projects.length} projects</span>
                            <button className="btn btn-ghost btn-sm" style={{ fontSize: '11px' }} data-testid={`button-gen-projects-${init.id}`}
                              onClick={e => { e.stopPropagation(); generateProjects(init) }} disabled={!!generating}>
                              {generating === `proj_${init.id}` ? <Loader2 size={11} className="spinner" /> : '✨'} Projects
                            </button>
                            <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--sia-red)', padding: '2px' }} onClick={e => { e.stopPropagation(); deleteNode(init.id) }}><Trash2 size={13} /></button>
                            {isExpInit ? <ChevronUp size={14} color="var(--sia-medium-gray)" /> : <ChevronDown size={14} color="var(--sia-medium-gray)" />}
                          </div>
                        </div>

                        {isExpInit && (
                          <div style={{ padding: '12px 16px', borderTop: '1px solid rgba(69,85,105,0.08)', background: '#FAFBFD' }}>
                            <div style={{ marginBottom: '10px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                              {projects.map((proj: any) => (
                                <div key={proj.id} data-testid={`project-${proj.id}`} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 12px', background: 'white', borderRadius: '6px', border: '1px solid rgba(69,85,105,0.08)' }}>
                                  <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#8B5CF6', flexShrink: 0 }} />
                                  <div style={{ flex: 1 }}>
                                    <input style={{ border: 'none', outline: 'none', fontSize: '12px', fontWeight: 500, color: 'var(--sia-navy)', background: 'transparent', width: '100%' }} defaultValue={proj.title} onBlur={e => { if (e.target.value !== proj.title) updateNodeField(proj.id, 'title', e.target.value) }} />
                                    {proj.description && <div style={{ fontSize: '11px', color: 'var(--sia-cool-gray)', marginTop: '1px' }}>{proj.description}</div>}
                                  </div>
                                  {proj.meta?.owner && <span style={{ fontSize: '11px', color: 'var(--sia-medium-gray)' }}>{proj.meta.owner}</span>}
                                  {proj.meta?.deliveryYear && (
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                      <Calendar size={11} color="var(--sia-medium-gray)" />
                                      <span style={{ fontSize: '11px', color: 'var(--sia-medium-gray)' }}>{proj.meta.deliveryYear}</span>
                                    </div>
                                  )}
                                  <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--sia-red)', padding: '2px' }} onClick={() => deleteNode(proj.id)}><Trash2 size={12} /></button>
                                </div>
                              ))}
                              {addingProject === init.id ? (
                                <div style={{ display: 'flex', gap: '6px' }}>
                                  <input autoFocus value={newProjTitle} onChange={e => setNewProjTitle(e.target.value)}
                                    onKeyDown={e => { if (e.key === 'Enter') addNode(init.id, init.level + 1, newProjTitle); if (e.key === 'Escape') { setAddingProject(null); setNewProjTitle('') } }}
                                    placeholder="Project name..." style={{ flex: 1, padding: '6px 10px', border: '1.5px solid var(--sia-teal)', borderRadius: '6px', fontSize: '12px', outline: 'none' }} />
                                  <button className="btn btn-primary btn-sm" onClick={() => addNode(init.id, init.level + 1, newProjTitle)}>Add</button>
                                  <button className="btn btn-ghost btn-sm" onClick={() => { setAddingProject(null); setNewProjTitle('') }}>✕</button>
                                </div>
                              ) : (
                                <button onClick={() => setAddingProject(init.id)} style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '6px 12px', background: 'transparent', border: '1px dashed rgba(69,85,105,0.2)', borderRadius: '6px', cursor: 'pointer', color: 'var(--sia-cool-gray)', fontSize: '12px', width: '100%' }}>
                                  <Plus size={12} /> Add Project
                                </button>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}

                  {addingInitiative === obj.id ? (
                    <div style={{ display: 'flex', gap: '6px' }}>
                      <input autoFocus value={newInitTitle} onChange={e => setNewInitTitle(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') addNode(obj.id, obj.level + 1, newInitTitle); if (e.key === 'Escape') { setAddingInitiative(null); setNewInitTitle('') } }}
                        placeholder="Initiative title..." style={{ flex: 1, padding: '8px 12px', border: '1.5px solid var(--sia-teal)', borderRadius: 'var(--radius)', fontSize: '13px', outline: 'none' }} />
                      <button className="btn btn-primary btn-sm" onClick={() => addNode(obj.id, obj.level + 1, newInitTitle)}>Add</button>
                      <button className="btn btn-ghost btn-sm" onClick={() => { setAddingInitiative(null); setNewInitTitle('') }}>✕</button>
                    </div>
                  ) : (
                    <button onClick={() => setAddingInitiative(obj.id)} data-testid={`button-add-initiative-${obj.id}`}
                      style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 16px', background: 'transparent', border: '1.5px dashed rgba(0,222,204,0.3)', borderRadius: 'var(--radius)', cursor: 'pointer', color: 'var(--sia-teal)', fontSize: '13px', fontWeight: 500 }}>
                      <Plus size={14} /> Add Initiative
                    </button>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
