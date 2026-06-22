'use client'
import React, { useState } from 'react'
import { useStore } from '@/store/useStore'
import { projectsApi, aiApi } from '@/lib/api'
import { Plus, Trash2, Edit3, Save, X, Loader2, MessageSquare, ChevronRight, GitBranch } from 'lucide-react'
import EntityBanner from '@/components/EntityBanner'

const LEVEL_COLORS = ['#173044','#00DECC','#10B981','#3B82F6','#8B5CF6','#F59E0B']
const LEVEL_BG = ['#F8FAFB','rgba(0,222,204,0.06)','rgba(16,185,129,0.06)','rgba(59,130,246,0.06)','rgba(139,92,246,0.06)','rgba(245,158,11,0.06)']

function uuid() { return crypto.randomUUID() }

export default function StrategyPage() {
  const { project, setProject, activeEntityId } = useStore()
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [editingNode, setEditingNode] = useState<any | null>(null)
  const [generating, setGenerating] = useState<string | null>(null)
  const [chatInput, setChatInput] = useState('')
  const [chatMessages, setChatMessages] = useState<any[]>([])
  const [chatStreaming, setChatStreaming] = useState(false)
  const [addingChild, setAddingChild] = useState<string | null>(null)
  const [newChildTitle, setNewChildTitle] = useState('')

  if (!project) return null

  const activeEntity = activeEntityId ? (project.entities || []).find((e: any) => e.id === activeEntityId) : null
  const strategy = activeEntity?.strategy || project.strategy
  const levelNames = strategy?.levelNames || ['Vision','Strategic Option','Outcome','Initiative']
  const nodes: any[] = strategy?.nodes || []

  const selectedNode = selectedNodeId ? nodes.find(n => n.id === selectedNodeId) : null

  function getChildren(parentId: string | null) {
    return nodes.filter(n => n.parentId === parentId).sort((a: any, b: any) => (a.order || 0) - (b.order || 0))
  }

  async function saveStrategy(newNodes: any[]) {
    if (activeEntity) {
      await projectsApi.updateEntityStrategy(project!.id, activeEntity.id, { nodes: newNodes })
    } else {
      await projectsApi.updateStrategy(project!.id, { nodes: newNodes })
    }
    const res = await projectsApi.get(project!.id)
    setProject(res.data)
  }

  async function addNode(parentId: string | null, level: number, title: string) {
    if (!title.trim()) return
    const newNode = { id: uuid(), parentId, level, title, description: '', aiDraft: '', linkedPillar: null, kpis: [], initiatives: [], order: getChildren(parentId).length }
    const newNodes = [...nodes, newNode]
    await saveStrategy(newNodes)
    setSelectedNodeId(newNode.id)
    setAddingChild(null)
    setNewChildTitle('')
  }

  async function updateNode(nodeId: string, updates: any) {
    const newNodes = nodes.map(n => n.id === nodeId ? { ...n, ...updates } : n)
    await saveStrategy(newNodes)
    setEditingNode(null)
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
    setSelectedNodeId(null)
  }

  async function generateAI(task: string, nodeId?: string) {
    setGenerating(task)
    try {
      let context: any = {}
      if (task === 'vision_mission') {
        const res = await aiApi.generateStrategy(project!.id, task, { entityId: activeEntityId || undefined })
        const { vision, mission } = res.data.data
        const vNode = nodes.find(n => n.level === 0)
        if (vNode) {
          await updateNode(vNode.id, { title: vision, description: mission })
        } else {
          await addNode(null, 0, vision)
        }
      } else if (task === 'strategic_objectives') {
        context.count = 4
        const res = await aiApi.generateStrategy(project!.id, task, { ...context, entityId: activeEntityId || undefined })
        const { objectives } = res.data.data
        const vision = nodes.find(n => n.level === 0)
        for (const obj of (objectives || [])) {
          await addNode(vision?.id || null, 1, obj.title)
        }
      } else if (task === 'kpis' && nodeId) {
        const node = nodes.find(n => n.id === nodeId)
        context.objectiveTitle = node?.title
        const res = await aiApi.generateStrategy(project!.id, task, { ...context, entityId: activeEntityId || undefined })
        const newNodes = nodes.map(n => n.id === nodeId ? { ...n, kpis: res.data.data.kpis || [] } : n)
        await saveStrategy(newNodes)
      } else if (task === 'consistency_check') {
        const res = await aiApi.generateStrategy(project!.id, task, { entityId: activeEntityId || undefined })
        const { issues, overallAssessment } = res.data.data
        alert(`Strategy Review:\n\n${overallAssessment}\n\nIssues Found:\n${(issues || []).map((i: any) => `• [${i.type}] ${i.description}`).join('\n')}`)
      }
    } catch (e: any) {
      alert('AI error: ' + (e.response?.data?.error || e.message))
    }
    setGenerating(null)
  }

  async function sendChat() {
    if (!chatInput.trim() || chatStreaming) return
    const userMsg = { role: 'user', content: chatInput }
    const newMessages = [...chatMessages, userMsg]
    setChatMessages(newMessages)
    setChatInput('')
    setChatStreaming(true)
    let aiText = ''
    setChatMessages((msgs: any[]) => [...msgs, { role: 'assistant', content: '', streaming: true }])
    try {
      for await (const data of aiApi.chat(project!.id, newMessages, { nodeId: selectedNodeId })) {
        if (data.chunk) {
          aiText += data.chunk
          setChatMessages((msgs: any[]) => msgs.map((m: any, i: number) => i === msgs.length - 1 ? { ...m, content: aiText } : m))
        }
        if (data.done) setChatMessages((msgs: any[]) => msgs.map((m: any, i: number) => i === msgs.length - 1 ? { ...m, streaming: false } : m))
      }
    } catch (e) {}
    setChatStreaming(false)
  }

  function TreeNode({ node, depth }: { node: any; depth: number }) {
    const children = getChildren(node.id)
    const isSelected = selectedNodeId === node.id
    const levelColor = LEVEL_COLORS[Math.min(node.level, LEVEL_COLORS.length - 1)]
    const nextLevelName = levelNames[node.level + 1]

    return (
      <div style={{ marginBottom: '2px' }}>
        <div
          data-testid={`node-${node.id}`}
          onClick={() => setSelectedNodeId(isSelected ? null : node.id)}
          style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 12px', paddingLeft: `${12 + depth * 20}px`, borderRadius: 'var(--radius)', background: isSelected ? 'rgba(0,222,204,0.08)' : 'transparent', border: `1.5px solid ${isSelected ? 'rgba(0,222,204,0.3)' : 'transparent'}`, cursor: 'pointer', transition: 'all 0.15s' }}
          onMouseEnter={e => { if (!isSelected) (e.currentTarget as HTMLElement).style.background = 'rgba(23,48,68,0.04)' }}
          onMouseLeave={e => { if (!isSelected) (e.currentTarget as HTMLElement).style.background = 'transparent' }}
        >
          {children.length > 0 && <ChevronRight size={13} color="var(--sia-medium-gray)" />}
          <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: levelColor, flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--sia-navy)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{node.title}</div>
            <div style={{ fontSize: '10px', color: 'var(--sia-medium-gray)' }}>{levelNames[node.level] || `Level ${node.level}`}</div>
          </div>
          {node.kpis?.length > 0 && <span style={{ fontSize: '10px', color: 'var(--sia-teal)', fontWeight: 600 }}>{node.kpis.length} KPIs</span>}
        </div>
        {children.map((child: any) => <TreeNode key={child.id} node={child} depth={depth + 1} />)}
        {isSelected && nextLevelName && (
          addingChild === node.id ? (
            <div style={{ display: 'flex', gap: '6px', paddingLeft: `${12 + (depth + 1) * 20}px`, paddingRight: '12px', paddingBottom: '6px' }}>
              <input autoFocus value={newChildTitle} onChange={e => setNewChildTitle(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') addNode(node.id, node.level + 1, newChildTitle); if (e.key === 'Escape') { setAddingChild(null); setNewChildTitle('') } }}
                placeholder={`New ${nextLevelName}...`} style={{ flex: 1, padding: '6px 10px', border: '1.5px solid var(--sia-teal)', borderRadius: '6px', fontSize: '12px', outline: 'none' }} />
              <button className="btn btn-primary btn-sm" style={{ padding: '6px 10px' }} onClick={() => addNode(node.id, node.level + 1, newChildTitle)}>Add</button>
              <button className="btn btn-ghost btn-sm" style={{ padding: '6px 10px' }} onClick={() => { setAddingChild(null); setNewChildTitle('') }}>✕</button>
            </div>
          ) : (
            <button onClick={e => { e.stopPropagation(); setAddingChild(node.id) }}
              style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 12px', paddingLeft: `${12 + (depth + 1) * 20}px`, background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--sia-teal)', fontSize: '11px', fontWeight: 600, width: '100%' }}>
              <Plus size={12} /> Add {nextLevelName}
            </button>
          )
        )}
      </div>
    )
  }

  const rootNodes = getChildren(null)

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
      <div style={{ width: '300px', background: 'white', borderRight: '1px solid rgba(69,85,105,0.1)', display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
        <div style={{ padding: '16px 16px 8px', borderBottom: '1px solid rgba(69,85,105,0.08)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
            <span style={{ fontFamily: 'var(--font-display)', fontSize: '14px', fontWeight: 700, color: 'var(--sia-navy)' }}>Strategy Tree</span>
            <div style={{ display: 'flex', gap: '4px' }}>
              <button className="btn btn-ghost btn-sm" style={{ padding: '4px 8px', fontSize: '11px' }} data-testid="button-check-consistency" onClick={() => generateAI('consistency_check')} disabled={!!generating}>
                {generating === 'consistency_check' ? <Loader2 size={11} className="spinner" /> : '🔍'} Check
              </button>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '10px' }}>
            {levelNames.slice(0, 4).map((name: string, i: number) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: LEVEL_COLORS[i], flexShrink: 0 }} />
                <span style={{ fontSize: '11px', color: 'var(--sia-cool-gray)', fontWeight: 500 }}>L{i}: {name}</span>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            <button className="btn btn-ghost btn-sm" style={{ padding: '5px 10px', fontSize: '11px' }} data-testid="button-gen-vision" onClick={() => generateAI('vision_mission')} disabled={!!generating}>
              {generating === 'vision_mission' ? <Loader2 size={11} className="spinner" /> : '✨'} Vision
            </button>
            <button className="btn btn-ghost btn-sm" style={{ padding: '5px 10px', fontSize: '11px' }} data-testid="button-gen-objectives" onClick={() => generateAI('strategic_objectives')} disabled={!!generating}>
              {generating === 'strategic_objectives' ? <Loader2 size={11} className="spinner" /> : '🎯'} Objectives
            </button>
          </div>
        </div>

        <div style={{ flex: 1, overflow: 'auto', padding: '10px 8px' }}>
          {rootNodes.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px 16px', color: 'var(--sia-medium-gray)' }}>
              <GitBranch size={32} style={{ margin: '0 auto 12px', opacity: 0.3 }} />
              <div style={{ fontSize: '13px', fontWeight: 500, marginBottom: '4px' }}>Empty Strategy Tree</div>
              <div style={{ fontSize: '12px', marginBottom: '12px' }}>Generate Vision & Mission or add a node manually</div>
              <button className="btn btn-primary btn-sm" data-testid="button-add-root" onClick={() => { setAddingChild('root') }}>
                <Plus size={12} /> Add Vision
              </button>
              {addingChild === 'root' && (
                <div style={{ display: 'flex', gap: '6px', marginTop: '8px' }}>
                  <input autoFocus value={newChildTitle} onChange={e => setNewChildTitle(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') addNode(null, 0, newChildTitle); if (e.key === 'Escape') { setAddingChild(null); setNewChildTitle('') } }}
                    placeholder="Vision statement..." style={{ flex: 1, padding: '6px 10px', border: '1.5px solid var(--sia-teal)', borderRadius: '6px', fontSize: '12px', outline: 'none' }} />
                  <button className="btn btn-primary btn-sm" style={{ padding: '6px 10px' }} onClick={() => addNode(null, 0, newChildTitle)}>Add</button>
                </div>
              )}
            </div>
          ) : (
            rootNodes.map((node: any) => <TreeNode key={node.id} node={node} depth={0} />)
          )}
          {rootNodes.length > 0 && (
            addingChild === 'root' ? (
              <div style={{ display: 'flex', gap: '6px', padding: '6px 8px' }}>
                <input autoFocus value={newChildTitle} onChange={e => setNewChildTitle(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') addNode(null, 0, newChildTitle); if (e.key === 'Escape') { setAddingChild(null); setNewChildTitle('') } }}
                  placeholder="Vision..." style={{ flex: 1, padding: '6px 10px', border: '1.5px solid var(--sia-teal)', borderRadius: '6px', fontSize: '12px', outline: 'none' }} />
                <button className="btn btn-primary btn-sm" style={{ padding: '6px 10px' }} onClick={() => addNode(null, 0, newChildTitle)}>Add</button>
                <button className="btn btn-ghost btn-sm" style={{ padding: '6px 10px' }} onClick={() => { setAddingChild(null); setNewChildTitle('') }}>✕</button>
              </div>
            ) : (
              <button onClick={() => setAddingChild('root')} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 12px', background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--sia-teal)', fontSize: '12px', fontWeight: 600, width: '100%' }}>
                <Plus size={13} /> Add Vision Node
              </button>
            )
          )}
        </div>
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: '24px', borderRight: '1px solid rgba(69,85,105,0.1)' }}>
        <EntityBanner note={activeEntity ? `Strategy Builder is scoped to ${activeEntity.name}. Switch entities in the sidebar to build a separate strategy.` : 'Viewing the main project strategy. Select a subsidiary in the sidebar to build its own strategy tree.'} compact />
        {!selectedNode ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', flexDirection: 'column', gap: '16px', color: 'var(--sia-medium-gray)' }}>
            <GitBranch size={48} style={{ opacity: 0.2 }} />
            <div>
              <h3 style={{ fontSize: '18px', fontWeight: 600, color: 'var(--sia-cool-gray)', marginBottom: '6px', textAlign: 'center' }}>Select a node to view details</h3>
              <p style={{ fontSize: '13px', textAlign: 'center' }}>Click any node in the tree to edit its title, description, and KPIs</p>
            </div>
          </div>
        ) : (
          <div style={{ maxWidth: '600px' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '20px' }}>
              <div>
                <div style={{ fontSize: '11px', color: 'var(--sia-medium-gray)', textTransform: 'uppercase', fontWeight: 600, letterSpacing: '0.5px', marginBottom: '4px' }}>
                  {levelNames[selectedNode.level] || `Level ${selectedNode.level}`}
                </div>
                <div style={{ display: 'flex', gap: '6px' }}>
                  <div style={{ width: '4px', height: '28px', borderRadius: '2px', background: LEVEL_COLORS[Math.min(selectedNode.level, LEVEL_COLORS.length - 1)] }} />
                  <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '22px', fontWeight: 800, color: 'var(--sia-navy)', lineHeight: 1.2 }}>{selectedNode.title}</h2>
                </div>
              </div>
              <div style={{ display: 'flex', gap: '6px' }}>
                <button className="btn btn-ghost btn-sm" data-testid="button-edit-node" onClick={() => setEditingNode({ ...selectedNode })}>
                  <Edit3 size={12} /> Edit
                </button>
                <button className="btn btn-danger btn-sm" data-testid="button-delete-node" onClick={() => deleteNode(selectedNode.id)}>
                  <Trash2 size={12} /> Delete
                </button>
              </div>
            </div>

            {editingNode?.id === selectedNode.id ? (
              <div className="card" style={{ padding: '20px', marginBottom: '16px' }}>
                <div className="form-group" style={{ marginBottom: '14px' }}>
                  <label className="form-label">Title</label>
                  <input className="form-input" value={editingNode.title} onChange={e => setEditingNode((n: any) => ({...n, title: e.target.value}))} />
                </div>
                <div className="form-group" style={{ marginBottom: '14px' }}>
                  <label className="form-label">Description</label>
                  <textarea className="form-input" value={editingNode.description || ''} onChange={e => setEditingNode((n: any) => ({...n, description: e.target.value}))} rows={4} />
                </div>
                <div className="form-group" style={{ marginBottom: '14px' }}>
                  <label className="form-label">Linked Pillar</label>
                  <select className="form-input form-select" value={editingNode.linkedPillar || ''} onChange={e => setEditingNode((n: any) => ({...n, linkedPillar: e.target.value || null}))}>
                    <option value="">None</option>
                    {['P1','P2','P3','P4','P5','P6','P7','P8'].map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button className="btn btn-primary btn-sm" data-testid="button-save-node" onClick={() => updateNode(editingNode.id, editingNode)}><Save size={12} /> Save</button>
                  <button className="btn btn-ghost btn-sm" onClick={() => setEditingNode(null)}><X size={12} /> Cancel</button>
                </div>
              </div>
            ) : (
              selectedNode.description && (
                <div className="card" style={{ padding: '16px 20px', marginBottom: '16px' }}>
                  <p style={{ fontSize: '14px', color: 'var(--sia-cool-gray)', lineHeight: 1.7 }}>{selectedNode.description}</p>
                  {selectedNode.linkedPillar && (
                    <div style={{ marginTop: '10px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span style={{ fontSize: '11px', color: 'var(--sia-medium-gray)' }}>Linked to:</span>
                      <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--sia-teal)', padding: '2px 8px', background: 'rgba(0,222,204,0.1)', borderRadius: '4px' }}>{selectedNode.linkedPillar}</span>
                    </div>
                  )}
                </div>
              )
            )}

            <div className="card" style={{ padding: '16px 20px', marginBottom: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--sia-navy)' }}>KPIs ({selectedNode.kpis?.length || 0})</span>
                <button className="btn btn-ghost btn-sm" style={{ fontSize: '11px' }} data-testid="button-gen-kpis" onClick={() => generateAI('kpis', selectedNode.id)} disabled={!!generating}>
                  {generating === 'kpis' ? <Loader2 size={11} className="spinner" /> : '✨'} Generate KPIs
                </button>
              </div>
              {(selectedNode.kpis || []).length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {selectedNode.kpis.map((kpi: any, i: number) => (
                    <div key={i} style={{ padding: '10px 14px', background: 'var(--sia-light-gray)', borderRadius: 'var(--radius)', borderLeft: '3px solid var(--sia-teal)' }}>
                      <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--sia-navy)', marginBottom: '4px' }}>{kpi.indicator}</div>
                      <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
                        {kpi.baseline && <span style={{ fontSize: '12px', color: 'var(--sia-cool-gray)' }}>Baseline: <strong>{kpi.baseline}</strong></span>}
                        {kpi.target && <span style={{ fontSize: '12px', color: 'var(--sia-cool-gray)' }}>Target: <strong>{kpi.target} {kpi.unit}</strong></span>}
                        {kpi.targetYear && <span style={{ fontSize: '12px', color: 'var(--sia-cool-gray)' }}>By {kpi.targetYear}</span>}
                        {kpi.owner && <span style={{ fontSize: '12px', color: 'var(--sia-medium-gray)' }}>Owner: {kpi.owner}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ fontSize: '13px', color: 'var(--sia-medium-gray)', fontStyle: 'italic' }}>No KPIs yet — click "Generate KPIs" or add manually</div>
              )}
            </div>
          </div>
        )}
      </div>

      <div style={{ width: '280px', display: 'flex', flexDirection: 'column', background: 'var(--sia-cool-black)', flexShrink: 0 }}>
        <div style={{ padding: '16px 16px 10px', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <MessageSquare size={14} color="var(--sia-teal)" />
          <span style={{ fontSize: '13px', fontWeight: 600, color: 'white' }}>AI Strategy Co-pilot</span>
        </div>
        <div style={{ flex: 1, overflow: 'auto', padding: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {chatMessages.length === 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.4)', marginBottom: '4px' }}>Start with:</div>
              {[
                'Suggest 4 strategic objectives based on our assessment',
                'What KPIs should we track for Revenue growth?',
                'Identify missing elements in our strategy',
              ].map(q => (
                <button key={q} onClick={() => setChatInput(q)}
                  style={{ padding: '8px 10px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '6px', fontSize: '11px', color: 'rgba(255,255,255,0.7)', cursor: 'pointer', textAlign: 'left', lineHeight: 1.4 }}>
                  {q}
                </button>
              ))}
            </div>
          )}
          {chatMessages.map((msg: any, i: number) => (
            <div key={i} style={{ display: 'flex', gap: '8px', flexDirection: msg.role === 'user' ? 'row-reverse' : 'row' }}>
              <div style={{ width: '22px', height: '22px', borderRadius: '50%', background: msg.role === 'user' ? 'rgba(255,255,255,0.08)' : 'var(--sia-teal)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '9px', fontWeight: 700, color: msg.role === 'user' ? 'rgba(255,255,255,0.6)' : 'var(--sia-cool-black)', flexShrink: 0 }}>
                {msg.role === 'user' ? 'U' : 'AI'}
              </div>
              <div style={{ maxWidth: '85%', padding: '8px 10px', background: msg.role === 'user' ? 'rgba(255,255,255,0.07)' : 'rgba(0,222,204,0.1)', borderRadius: '8px', fontSize: '12px', color: 'rgba(255,255,255,0.85)', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
                {msg.content}
                {msg.streaming && <span className="streaming" />}
              </div>
            </div>
          ))}
        </div>
        <div style={{ padding: '10px', borderTop: '1px solid rgba(255,255,255,0.06)', display: 'flex', gap: '6px' }}>
          <input type="text" value={chatInput} onChange={e => setChatInput(e.target.value)} data-testid="strategy-chat-input"
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat() } }}
            placeholder="Ask about strategy..."
            style={{ flex: 1, padding: '8px 10px', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', background: 'rgba(255,255,255,0.06)', fontFamily: 'var(--font-body)', fontSize: '12px', color: 'white', outline: 'none' }}
          />
          <button style={{ padding: '8px 10px', background: 'var(--sia-teal)', border: 'none', borderRadius: '6px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }} data-testid="button-strategy-send" onClick={sendChat} disabled={chatStreaming || !chatInput.trim()}>
            {chatStreaming ? <Loader2 size={13} color="var(--sia-cool-black)" className="spinner" /> : <span style={{ fontSize: '13px', color: 'var(--sia-cool-black)', fontWeight: 700 }}>→</span>}
          </button>
        </div>
      </div>
    </div>
  )
}
