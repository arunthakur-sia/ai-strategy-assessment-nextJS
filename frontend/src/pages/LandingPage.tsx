import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore'
import { projectsApi } from '../api'
import { Plus, Lock, ArrowRight, Building2, Loader2 } from 'lucide-react'

export default function LandingPage() {
  const navigate = useNavigate()
  const { setProject, setAuthenticated } = useStore()
  const [projects, setProjects] = useState<any[]>([])
  const [mode, setMode] = useState<'list' | 'create' | 'unlock'>('list')
  const [selectedProject, setSelectedProject] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState({
    name: '', entityName: '', entityType: 'government', consultantName: '', password: '', confirmPassword: ''
  })
  const [unlockPassword, setUnlockPassword] = useState('')

  useEffect(() => { loadProjects() }, [])

  async function loadProjects() {
    try {
      const res = await projectsApi.list()
      setProjects(res.data)
    } catch (e) {}
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (form.password !== form.confirmPassword) { setError('Passwords do not match'); return }
    if (form.password.length < 6) { setError('Password must be at least 6 characters'); return }
    setLoading(true); setError('')
    try {
      const res = await projectsApi.create(form)
      const proj = await projectsApi.get(res.data.id)
      setProject(proj.data)
      setAuthenticated(true)
      navigate('/app/dashboard')
    } catch (e: any) {
      setError(e.response?.data?.error || 'Failed to create project')
    } finally { setLoading(false) }
  }

  async function handleUnlock(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true); setError('')
    try {
      await projectsApi.unlock(selectedProject.id, unlockPassword)
      const proj = await projectsApi.get(selectedProject.id)
      setProject(proj.data)
      setAuthenticated(true)
      navigate('/app/dashboard')
    } catch (e: any) {
      setError(e.response?.data?.error || 'Invalid password')
    } finally { setLoading(false) }
  }

  const entityTypes = [
    { value: 'government', label: 'Government Ministry / Authority' },
    { value: 'holding', label: 'Holding Company' },
    { value: 'corporate', label: 'Corporate / Private Sector' },
    { value: 'ngo', label: 'NGO / Non-Profit' },
    { value: 'other', label: 'Other' },
  ]

  return (
    <div style={{ minHeight: '100vh', background: 'var(--sia-cool-black)', display: 'flex', flexDirection: 'column' }}>
      <header style={{ padding: '24px 40px', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <img src="/sia-logo.png" alt="SIA" style={{ height: '36px', width: 'auto', display: 'block', mixBlendMode: 'screen' }} />
        <span style={{ fontSize: '13px', color: 'var(--sia-medium-gray)', letterSpacing: '0.5px', textTransform: 'uppercase' }}>Strategy Assessment Agent</span>
      </header>

      <div style={{ flex: 1, display: 'flex' }}>
        <div style={{ flex: 1, padding: '80px 60px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <div style={{ maxWidth: '480px' }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', background: 'rgba(0,222,204,0.1)', border: '1px solid rgba(0,222,204,0.2)', borderRadius: '999px', padding: '6px 16px', marginBottom: '32px' }}>
              <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'var(--sia-teal)' }} />
              <span style={{ fontSize: '12px', color: 'var(--sia-teal)', fontWeight: 500, letterSpacing: '0.5px', textTransform: 'uppercase' }}>AI-Powered Assessment Platform</span>
            </div>

            <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '52px', fontWeight: 800, color: 'white', lineHeight: 1.1, marginBottom: '24px' }}>
              Strategy <span style={{ color: 'var(--sia-teal)' }}>Builder</span>
            </h1>

            <p style={{ fontSize: '16px', color: 'var(--sia-medium-gray)', lineHeight: 1.7, marginBottom: '48px' }}>
              Automate the full lifecycle of a strategy engagement — from document ingestion and 8-pillar assessment through to strategy formulation, KPIs, and initiative planning.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {[
                ['8-Pillar Assessment Framework', 'AI-scored with evidence from your documents'],
                ['Flexible Strategy Builder', 'Vision → Objectives → KPIs → Initiatives → Projects'],
                ['5 Export-Ready Deliverables', 'D1–D5 reports in structured markdown format'],
              ].map(([title, desc]) => (
                <div key={title} style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
                  <div style={{ width: '20px', height: '20px', borderRadius: '50%', background: 'var(--sia-teal)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: '2px' }}>
                    <span style={{ color: 'var(--sia-cool-black)', fontSize: '11px', fontWeight: 700 }}>✓</span>
                  </div>
                  <div>
                    <div style={{ fontSize: '14px', fontWeight: 600, color: 'white', marginBottom: '2px' }}>{title}</div>
                    <div style={{ fontSize: '13px', color: 'var(--sia-medium-gray)' }}>{desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div style={{ width: '480px', background: 'rgba(255,255,255,0.03)', borderLeft: '1px solid rgba(255,255,255,0.06)', padding: '48px 40px', display: 'flex', flexDirection: 'column', gap: '24px', overflowY: 'auto' }}>

          {mode === 'list' && (
            <>
              <div>
                <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '22px', fontWeight: 700, color: 'white', marginBottom: '6px' }}>Your Projects</h2>
                <p style={{ fontSize: '13px', color: 'var(--sia-medium-gray)' }}>Select an existing project or start a new assessment</p>
              </div>

              <button className="btn btn-primary btn-lg" data-testid="button-new-project" style={{ justifyContent: 'center', gap: '10px' }} onClick={() => { setMode('create'); setError('') }}>
                <Plus size={18} />
                New Assessment Project
              </button>

              {projects.length > 0 && (
                <div>
                  <div style={{ fontSize: '11px', color: 'var(--sia-medium-gray)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '12px', fontWeight: 600 }}>Recent Projects</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {projects.map((p: any) => (
                      <button key={p.id} data-testid={`button-project-${p.id}`} onClick={() => { setSelectedProject(p); setMode('unlock'); setError('') }}
                        style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '14px 16px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 'var(--radius-lg)', cursor: 'pointer', textAlign: 'left', transition: 'all 0.15s' }}
                        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(0,222,204,0.08)'; (e.currentTarget as HTMLElement).style.borderColor = 'rgba(0,222,204,0.3)' }}
                        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.04)'; (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,0.08)' }}
                      >
                        <div style={{ width: '36px', height: '36px', borderRadius: '8px', background: 'rgba(0,222,204,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                          <Building2 size={16} color="var(--sia-teal)" />
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: '14px', fontWeight: 600, color: 'white', marginBottom: '2px' }}>{p.entityName}</div>
                          <div style={{ fontSize: '12px', color: 'var(--sia-medium-gray)' }}>{p.name}</div>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '2px' }}>
                          <Lock size={13} color="var(--sia-medium-gray)" />
                          <span style={{ fontSize: '11px', color: 'var(--sia-medium-gray)' }}>{new Date(p.updatedAt).toLocaleDateString()}</span>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {projects.length === 0 && (
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: '12px', color: 'var(--sia-medium-gray)', padding: '40px 0' }}>
                  <Building2 size={40} color="rgba(135,150,169,0.3)" />
                  <p style={{ fontSize: '14px', textAlign: 'center' }}>No projects yet.<br />Create your first assessment above.</p>
                </div>
              )}
            </>
          )}

          {mode === 'create' && (
            <>
              <div>
                <button onClick={() => { setMode('list'); setError('') }} style={{ background: 'none', border: 'none', color: 'var(--sia-medium-gray)', cursor: 'pointer', fontSize: '13px', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  ← Back
                </button>
                <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '22px', fontWeight: 700, color: 'white', marginBottom: '6px' }}>New Project</h2>
                <p style={{ fontSize: '13px', color: 'var(--sia-medium-gray)' }}>Set up your assessment engagement</p>
              </div>

              <form onSubmit={handleCreate} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div className="form-group">
                  <label className="form-label" style={{ color: 'var(--sia-medium-gray)' }}>Project Name</label>
                  <input className="form-input" data-testid="input-project-name" placeholder="e.g. MOCI Strategy Assessment 2025" value={form.name}
                    onChange={e => setForm(f => ({...f, name: e.target.value}))} required
                    style={{ background: 'rgba(255,255,255,0.06)', border: '1.5px solid rgba(255,255,255,0.1)', color: 'white' }} />
                </div>

                <div className="form-group">
                  <label className="form-label" style={{ color: 'var(--sia-medium-gray)' }}>Entity Name</label>
                  <input className="form-input" data-testid="input-entity-name" placeholder="e.g. Ministry of Commerce and Industry" value={form.entityName}
                    onChange={e => setForm(f => ({...f, entityName: e.target.value}))} required
                    style={{ background: 'rgba(255,255,255,0.06)', border: '1.5px solid rgba(255,255,255,0.1)', color: 'white' }} />
                </div>

                <div className="form-group">
                  <label className="form-label" style={{ color: 'var(--sia-medium-gray)' }}>Entity Type</label>
                  <select className="form-input form-select" data-testid="select-entity-type" value={form.entityType}
                    onChange={e => setForm(f => ({...f, entityType: e.target.value}))}
                    style={{ background: 'rgba(255,255,255,0.06)', border: '1.5px solid rgba(255,255,255,0.1)', color: 'white' }}>
                    {entityTypes.map(t => <option key={t.value} value={t.value} style={{ background: '#173044' }}>{t.label}</option>)}
                  </select>
                </div>

                <div className="form-group">
                  <label className="form-label" style={{ color: 'var(--sia-medium-gray)' }}>Lead Consultant</label>
                  <input className="form-input" data-testid="input-consultant" placeholder="Your name" value={form.consultantName}
                    onChange={e => setForm(f => ({...f, consultantName: e.target.value}))}
                    style={{ background: 'rgba(255,255,255,0.06)', border: '1.5px solid rgba(255,255,255,0.1)', color: 'white' }} />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                  <div className="form-group">
                    <label className="form-label" style={{ color: 'var(--sia-medium-gray)' }}>Password</label>
                    <input className="form-input" data-testid="input-password" type="password" placeholder="Min 6 chars" value={form.password}
                      onChange={e => setForm(f => ({...f, password: e.target.value}))} required
                      style={{ background: 'rgba(255,255,255,0.06)', border: '1.5px solid rgba(255,255,255,0.1)', color: 'white' }} />
                  </div>
                  <div className="form-group">
                    <label className="form-label" style={{ color: 'var(--sia-medium-gray)' }}>Confirm</label>
                    <input className="form-input" data-testid="input-confirm-password" type="password" placeholder="Repeat" value={form.confirmPassword}
                      onChange={e => setForm(f => ({...f, confirmPassword: e.target.value}))} required
                      style={{ background: 'rgba(255,255,255,0.06)', border: '1.5px solid rgba(255,255,255,0.1)', color: 'white' }} />
                  </div>
                </div>

                {error && <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 'var(--radius)', padding: '10px 14px', fontSize: '13px', color: 'var(--sia-red)' }}>{error}</div>}

                <button className="btn btn-primary btn-lg" data-testid="button-create-project" type="submit" disabled={loading} style={{ justifyContent: 'center', marginTop: '8px' }}>
                  {loading ? <><Loader2 size={16} className="spinner" /> Creating...</> : <>Create Project <ArrowRight size={16} /></>}
                </button>
              </form>
            </>
          )}

          {mode === 'unlock' && selectedProject && (
            <>
              <div>
                <button onClick={() => { setMode('list'); setError('') }} style={{ background: 'none', border: 'none', color: 'var(--sia-medium-gray)', cursor: 'pointer', fontSize: '13px', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  ← Back
                </button>
                <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '22px', fontWeight: 700, color: 'white', marginBottom: '6px' }}>Unlock Project</h2>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '14px', background: 'rgba(0,222,204,0.08)', border: '1px solid rgba(0,222,204,0.2)', borderRadius: 'var(--radius-lg)', marginTop: '16px' }}>
                  <Building2 size={18} color="var(--sia-teal)" />
                  <div>
                    <div style={{ fontSize: '15px', fontWeight: 600, color: 'white' }}>{selectedProject.entityName}</div>
                    <div style={{ fontSize: '12px', color: 'var(--sia-medium-gray)' }}>{selectedProject.name}</div>
                  </div>
                </div>
              </div>

              <form onSubmit={handleUnlock} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div className="form-group">
                  <label className="form-label" style={{ color: 'var(--sia-medium-gray)' }}>Project Password</label>
                  <input className="form-input" data-testid="input-unlock-password" type="password" placeholder="Enter project password" value={unlockPassword}
                    onChange={e => setUnlockPassword(e.target.value)} required autoFocus
                    style={{ background: 'rgba(255,255,255,0.06)', border: '1.5px solid rgba(255,255,255,0.1)', color: 'white', fontSize: '16px' }} />
                </div>

                {error && <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 'var(--radius)', padding: '10px 14px', fontSize: '13px', color: 'var(--sia-red)' }}>{error}</div>}

                <button className="btn btn-primary btn-lg" data-testid="button-unlock" type="submit" disabled={loading} style={{ justifyContent: 'center' }}>
                  {loading ? <><Loader2 size={16} className="spinner" /> Unlocking...</> : <>Unlock <Lock size={16} /></>}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
