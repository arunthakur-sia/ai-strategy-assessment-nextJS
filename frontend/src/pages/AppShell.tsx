import React, { useEffect } from 'react'
import { Routes, Route, useNavigate, useLocation } from 'react-router-dom'
import { useStore } from '../store/useStore'
import {
  LayoutDashboard, Settings, Search, BarChart3, GitBranch,
  Target, Download, LogOut, ChevronLeft, ChevronRight,
  Building2, Globe, BookOpen, Layers, Loader2
} from 'lucide-react'
import { parseCitations } from '../components/CitedText'
import { SourcesPanel, type NewSource } from '../components/SourcesPanel'
import { projectsApi } from '../api'
import Dashboard from './Dashboard'
import SetupPage from './SetupPage'
import AssessmentPage from './AssessmentPage'
import SwotPage from './SwotPage'
import StrategyPage from './StrategyPage'
import InitiativesPage from './InitiativesPage'
import OutputsPage from './OutputsPage'
import RubricPage from './RubricPage'

const NAV_ITEMS = [
  { path: '/app/dashboard', icon: LayoutDashboard, label: 'Dashboard', key: 'dashboard' },
  { path: '/app/setup', icon: Settings, label: 'Project Setup', key: 'setup' },
  { path: '/app/assessment', icon: Search, label: 'Assessment', key: 'assessment' },
  { path: '/app/rubric', icon: BookOpen, label: 'Grading Rubric', key: 'rubric' },
  { path: '/app/swot', icon: BarChart3, label: 'SWOT Analysis', key: 'swot' },
  { path: '/app/strategy', icon: GitBranch, label: 'Strategy Builder', key: 'strategy' },
  { path: '/app/initiatives', icon: Target, label: 'Initiatives', key: 'initiatives' },
  { path: '/app/outputs', icon: Download, label: 'Export Center', key: 'outputs' },
]

const RAG_COLORS: Record<string, string> = { red: '#EF4444', amber: '#F59E0B', green: '#10B981', gray: 'var(--sia-medium-gray)' }

function entityOverallScore(entity: any): string | null {
  const pillars = Object.values(entity.assessment?.pillars || {})
  const scored = (pillars as any[]).filter((p: any) => p.finalScore !== null)
  if (!scored.length) return null
  return (scored.reduce((s: number, p: any) => s + (p.finalScore || 0), 0) / scored.length).toFixed(1)
}

export default function AppShell() {
  const navigate = useNavigate()
  const location = useLocation()
  const { project, sidebarCollapsed, toggleSidebar, logout, language, setLanguage, getOverallScore, getCompletionPercent, getRag, demoMode, activeEntityId, setActiveEntityId, sourcesOpen, activeSourceNum, setSourcesOpen, setActiveSourceNum, assessmentRunning, setProject } = useStore()

  // Poll for project updates every 5 s while any assessment is running,
  // so results arrive even if the user navigated away from the Assessment page.
  useEffect(() => {
    if (!assessmentRunning || !project) return
    const interval = setInterval(async () => {
      try {
        const res = await projectsApi.get(project.id)
        setProject(res.data)
      } catch { /* ignore poll errors */ }
    }, 5000)
    return () => clearInterval(interval)
  }, [assessmentRunning, project?.id])

  // Aggregate sources and citation texts from ALL pillars (main entity + all subsidiaries)
  const allGlobalSources: Record<string, NewSource> = {}
  const allGlobalTexts: string[] = []
  if (project) {
    const pillarGroups = [
      project.assessment.pillars,
      ...(project.entities || []).map((e: any) => e.assessment.pillars),
    ]
    for (const group of pillarGroups) {
      for (const p of Object.values(group) as any[]) {
        if (p.newSources) Object.assign(allGlobalSources, p.newSources)
        for (const mi of (p.missingInfo || [])) {
          if (mi.item) allGlobalTexts.push(mi.item)
          if (mi.impact) allGlobalTexts.push(mi.impact)
          if (mi.suggestedSource) allGlobalTexts.push(mi.suggestedSource)
        }
        if (p.execSummary?.edited) allGlobalTexts.push(p.execSummary.edited)
        for (const el of (p.elements || [])) {
          if (el.aiAnswer) allGlobalTexts.push(el.aiAnswer)
          if (el.scoreRationale) allGlobalTexts.push(el.scoreRationale)
          if (el.evidenceQuote) allGlobalTexts.push(el.evidenceQuote)
        }
        for (const key of ['strengths', 'weaknesses', 'opportunities', 'threats']) {
          for (const item of (p.swot?.[key] || [])) allGlobalTexts.push(item)
        }
        const iqRaw = p.interviewQuestions
        if (iqRaw && !Array.isArray(iqRaw) && (iqRaw.leadership || iqRaw.team || iqRaw.gapFilling)) {
          for (const q of [...(iqRaw.leadership || []), ...(iqRaw.team || [])]) allGlobalTexts.push(q)
          for (const item of (iqRaw.gapFilling || [])) { if (item.question) allGlobalTexts.push(item.question) }
        } else if (Array.isArray(iqRaw)) {
          for (const q of iqRaw) allGlobalTexts.push(q)
        }
      }
    }
  }
  const { allCitations: globalCitations } = parseCitations(allGlobalTexts.join(' '))

  const entities = project?.entities || []
  const activeEntity = activeEntityId ? entities.find(e => e.id === activeEntityId) : null
  const overallScore = activeEntity
    ? entityOverallScore(activeEntity)
    : getOverallScore()
  const completion = (() => {
    if (activeEntity) {
      const ps = Object.values(activeEntity.assessment?.pillars || {})
      return Math.round(((ps as any[]).filter((p: any) => p.status === 'complete').length / (ps.length || 1)) * 100)
    }
    return getCompletionPercent()
  })()
  const pillars = activeEntity
    ? (activeEntity.assessment?.pillars || {})
    : (project?.assessment?.pillars || {})
  const displayEntityName = activeEntity ? activeEntity.name : project?.entityName

  function handleLogout() {
    logout()
    navigate('/')
  }

  const isActive = (path: string) => location.pathname === path || location.pathname.startsWith(path + '/')

  return (
    <>
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      <aside style={{
        width: sidebarCollapsed ? '64px' : '240px',
        background: 'var(--sia-navy)',
        display: 'flex',
        flexDirection: 'column',
        transition: 'width 0.2s ease',
        overflow: 'hidden',
        flexShrink: 0,
        borderRight: '1px solid rgba(255,255,255,0.05)',
        zIndex: 10,
      }}>
        <div style={{ padding: sidebarCollapsed ? '20px 0' : '20px 20px', display: 'flex', alignItems: 'center', justifyContent: sidebarCollapsed ? 'center' : 'space-between', borderBottom: '1px solid rgba(255,255,255,0.06)', minHeight: '64px' }}>
          {!sidebarCollapsed && (
            <img src="/sia-logo.png" alt="SIA" style={{ height: '30px', width: 'auto', display: 'block', mixBlendMode: 'screen' }} />
          )}
          {sidebarCollapsed && (
            <img src="/sia-logo.png" alt="SIA" style={{ height: '24px', width: 'auto', display: 'block', mixBlendMode: 'screen' }} />
          )}
          <button onClick={toggleSidebar} data-testid="button-toggle-sidebar" style={{ background: 'none', border: 'none', color: 'var(--sia-medium-gray)', cursor: 'pointer', padding: '4px', borderRadius: '4px', display: 'flex', alignItems: 'center' }}>
            {sidebarCollapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
          </button>
        </div>

        {!sidebarCollapsed && project && (
          <div style={{ padding: '14px 20px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
              <div style={{ width: '28px', height: '28px', borderRadius: '6px', background: activeEntity ? 'rgba(139,92,246,0.2)' : 'rgba(0,222,204,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Building2 size={13} color={activeEntity ? '#8B5CF6' : 'var(--sia-teal)'} />
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: '12px', fontWeight: 600, color: 'white', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{displayEntityName}</div>
                <div style={{ fontSize: '10px', color: activeEntity ? '#A78BFA' : 'var(--sia-medium-gray)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {activeEntity ? 'Subsidiary Entity' : project.name}
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
              <span style={{ fontSize: '11px', color: 'var(--sia-medium-gray)' }}>Overall Score</span>
              <span style={{ fontFamily: 'var(--font-display)', fontSize: '14px', fontWeight: 700, color: overallScore ? 'var(--sia-teal)' : 'var(--sia-medium-gray)' }}>
                {overallScore || '—'} / 5
              </span>
            </div>
            <div className="progress-bar">
              <div className="progress-fill" style={{ width: `${completion}%` }} />
            </div>
            <div style={{ fontSize: '10px', color: 'var(--sia-medium-gray)', marginTop: '4px' }}>{completion}% assessed</div>
          </div>
        )}

        {/* Entity Selector — visible when project has subsidiary entities */}
        {!sidebarCollapsed && project && entities.length > 0 && (
          <div style={{ padding: '10px 12px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
              <Layers size={11} color="var(--sia-medium-gray)" />
              <span style={{ fontSize: '10px', color: 'var(--sia-medium-gray)', textTransform: 'uppercase', letterSpacing: '1px', fontWeight: 600 }}>Viewing Entity</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
              {/* Main entity option */}
              <button
                onClick={() => setActiveEntityId(null)}
                style={{
                  display: 'flex', alignItems: 'center', gap: '7px', padding: '6px 8px',
                  background: !activeEntityId ? 'rgba(0,222,204,0.12)' : 'rgba(255,255,255,0.03)',
                  border: `1px solid ${!activeEntityId ? 'rgba(0,222,204,0.35)' : 'rgba(255,255,255,0.07)'}`,
                  borderRadius: '6px', cursor: 'pointer', textAlign: 'left', width: '100%',
                  transition: 'all 0.15s',
                }}
              >
                <Building2 size={11} color={!activeEntityId ? 'var(--sia-teal)' : 'var(--sia-medium-gray)'} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: '11px', fontWeight: !activeEntityId ? 700 : 400, color: !activeEntityId ? 'var(--sia-teal)' : 'var(--sia-medium-gray)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {project.entityName}
                  </div>
                  <div style={{ fontSize: '9px', color: 'rgba(255,255,255,0.25)' }}>Main Entity</div>
                </div>
                {!activeEntityId && <div style={{ width: '5px', height: '5px', borderRadius: '50%', background: 'var(--sia-teal)', flexShrink: 0 }} />}
              </button>

              {/* Subsidiary entities */}
              {entities.map(entity => {
                const isActive = activeEntityId === entity.id
                const score = entityOverallScore(entity)
                return (
                  <button
                    key={entity.id}
                    onClick={() => setActiveEntityId(entity.id)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '7px', padding: '6px 8px',
                      background: isActive ? 'rgba(139,92,246,0.15)' : 'rgba(255,255,255,0.03)',
                      border: `1px solid ${isActive ? 'rgba(139,92,246,0.4)' : 'rgba(255,255,255,0.07)'}`,
                      borderRadius: '6px', cursor: 'pointer', textAlign: 'left', width: '100%',
                      transition: 'all 0.15s',
                    }}
                  >
                    <Building2 size={11} color={isActive ? '#A78BFA' : 'var(--sia-medium-gray)'} />
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: '11px', fontWeight: isActive ? 700 : 400, color: isActive ? '#A78BFA' : 'var(--sia-medium-gray)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {entity.name}
                      </div>
                      <div style={{ fontSize: '9px', color: 'rgba(255,255,255,0.25)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entity.type}</div>
                    </div>
                    {score
                      ? <span style={{ fontSize: '11px', fontWeight: 700, color: isActive ? '#A78BFA' : 'var(--sia-medium-gray)', flexShrink: 0 }}>{score}</span>
                      : isActive && <div style={{ width: '5px', height: '5px', borderRadius: '50%', background: '#A78BFA', flexShrink: 0 }} />
                    }
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {/* Collapsed sidebar — entity indicator dot */}
        {sidebarCollapsed && project && entities.length > 0 && (
          <div style={{ padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', justifyContent: 'center' }}>
            <div
              title={activeEntity ? `Viewing: ${activeEntity.name}` : `Viewing: ${project.entityName} (Main)`}
              style={{ width: '28px', height: '28px', borderRadius: '6px', background: activeEntity ? 'rgba(139,92,246,0.2)' : 'rgba(0,222,204,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
              onClick={toggleSidebar}
            >
              <Layers size={13} color={activeEntity ? '#A78BFA' : 'var(--sia-teal)'} />
            </div>
          </div>
        )}

        <nav style={{ flex: 1, padding: '12px 0', overflowY: 'auto' }}>
          {NAV_ITEMS.map(item => {
            const active = isActive(item.path)
            return (
              <button key={item.key} onClick={() => navigate(item.path)} data-testid={`nav-${item.key}`}
                title={sidebarCollapsed ? item.label : undefined}
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  padding: sidebarCollapsed ? '12px 0' : '10px 20px',
                  justifyContent: sidebarCollapsed ? 'center' : 'flex-start',
                  background: active ? 'rgba(0,222,204,0.1)' : 'transparent',
                  borderLeft: active ? '3px solid var(--sia-teal)' : '3px solid transparent',
                  border: 'none',
                  borderRight: 'none',
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                  color: active ? 'var(--sia-teal)' : 'var(--sia-medium-gray)',
                }}
                onMouseEnter={e => { if (!active) { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.04)'; (e.currentTarget as HTMLElement).style.color = 'white' } }}
                onMouseLeave={e => { if (!active) { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = 'var(--sia-medium-gray)' } }}
              >
                <item.icon size={16} />
                {!sidebarCollapsed && <span style={{ fontSize: '13px', fontWeight: active ? 600 : 400, whiteSpace: 'nowrap' }}>{item.label}</span>}
              </button>
            )
          })}
        </nav>

        {!sidebarCollapsed && (
          <div style={{ padding: '12px 20px', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
            <div style={{ fontSize: '10px', color: 'var(--sia-medium-gray)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '10px', fontWeight: 600 }}>Pillars</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px' }}>
              {Object.entries(pillars).map(([id, p]: [string, any]) => {
                const rag = getRag(p.finalScore)
                return (
                  <button key={id} onClick={() => { navigate('/app/assessment') }}
                    style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '4px 6px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '4px', cursor: 'pointer', fontSize: '11px', color: 'var(--sia-medium-gray)' }}
                  >
                    <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: RAG_COLORS[rag], flexShrink: 0 }} />
                    <span style={{ fontWeight: 600 }}>{id}</span>
                    {p.finalScore && <span style={{ color: RAG_COLORS[rag], marginLeft: 'auto' }}>{p.finalScore?.toFixed(1)}</span>}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        <div style={{ padding: '12px', borderTop: '1px solid rgba(255,255,255,0.06)', display: 'flex', gap: '6px', flexDirection: sidebarCollapsed ? 'column' : 'row', alignItems: 'center' }}>
          <button onClick={() => setLanguage(language === 'en' ? 'ar' : 'en')}
            title="Toggle language"
            data-testid="button-language"
            style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', padding: '8px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 'var(--radius)', cursor: 'pointer', color: 'var(--sia-medium-gray)', fontSize: '12px', fontWeight: 600 }}>
            <Globe size={13} />
            {!sidebarCollapsed && (language === 'en' ? 'عربي' : 'EN')}
          </button>
          <button onClick={handleLogout} title="Log out" data-testid="button-logout"
            style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', padding: '8px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 'var(--radius)', cursor: 'pointer', color: 'var(--sia-medium-gray)', fontSize: '12px' }}>
            <LogOut size={13} />
            {!sidebarCollapsed && 'Sign Out'}
          </button>
        </div>
      </aside>

      <main style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
        {demoMode && (
          <div data-testid="demo-mode-banner" style={{ background: '#FBBF24', color: '#1C1917', padding: '10px 20px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px', fontSize: '13px', fontWeight: 500, flexShrink: 0, flexWrap: 'wrap' }}>
            <span style={{ fontSize: '16px' }}>⚡</span>
            <span><strong>Demo Mode</strong> — AI responses are simulated.</span>
            <span>Configure <code style={{ background: 'rgba(0,0,0,0.12)', padding: '1px 6px', borderRadius: '4px', fontWeight: 700 }}>OAUTH2_CLIENT_ID</code> &amp; <code style={{ background: 'rgba(0,0,0,0.12)', padding: '1px 6px', borderRadius: '4px', fontWeight: 700 }}>OAUTH2_CLIENT_SECRET</code> to enable SiaGPT AI (Claude).</span>
          </div>
        )}
        {assessmentRunning && (
          <div data-testid="assessment-running-banner" style={{ background: 'rgba(0,222,204,0.12)', borderBottom: '1px solid rgba(0,222,204,0.25)', color: 'var(--sia-teal)', padding: '8px 20px', display: 'flex', alignItems: 'center', gap: '10px', fontSize: '13px', fontWeight: 500, flexShrink: 0 }}>
            <Loader2 size={15} style={{ animation: 'spin 1s linear infinite' }} />
            <span>Assessment in progress — you can navigate freely, results will be saved automatically.</span>
          </div>
        )}
        <Routes>
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/setup" element={<SetupPage />} />
          <Route path="/assessment" element={<AssessmentPage />} />
          <Route path="/rubric" element={<RubricPage />} />
          <Route path="/swot" element={<SwotPage />} />
          <Route path="/strategy" element={<StrategyPage />} />
          <Route path="/initiatives" element={<InitiativesPage />} />
          <Route path="/outputs" element={<OutputsPage />} />
          <Route path="*" element={<Dashboard />} />
        </Routes>
      </main>
    </div>

    {/* Global Sources toggle button — fixed to right edge */}
    {project && (
      <button
        onClick={() => setSourcesOpen(!sourcesOpen)}
        title={sourcesOpen ? 'Close sources sidebar' : 'Open sources sidebar'}
        style={{
          position: 'fixed',
          right: sourcesOpen ? '300px' : '0px',
          top: '50%',
          transform: 'translateY(-50%)',
          zIndex: 50,
          background: 'var(--sia-navy)',
          color: '#fff',
          border: 'none',
          borderRadius: '6px 0 0 6px',
          padding: '12px 6px',
          cursor: 'pointer',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '4px',
          boxShadow: '-2px 0 8px rgba(0,0,0,0.12)',
          transition: 'right 0.25s',
        }}
      >
        <BookOpen size={13} />
        <span style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)', fontSize: '10px', fontWeight: 700, letterSpacing: '0.8px', color: 'white', marginTop: '4px', textTransform: 'uppercase' }}>SOURCES</span>
        {(globalCitations.length > 0 || Object.keys(allGlobalSources).length > 0) && (
          <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: '16px', height: '16px', borderRadius: '8px', background: 'var(--sia-teal)', color: '#fff', fontSize: '9px', fontWeight: 700, marginTop: '4px' }}>
            {Object.keys(allGlobalSources).length || globalCitations.length}
          </span>
        )}
      </button>
    )}

    {/* Global Sources panel — fixed right sidebar */}
    {project && (
      <div
        style={{
          position: 'fixed',
          right: 0,
          top: 0,
          height: '100vh',
          width: sourcesOpen ? '300px' : '0px',
          overflow: 'hidden',
          transition: 'width 0.25s',
          background: '#fff',
          borderLeft: '1px solid rgba(69,85,105,0.1)',
          zIndex: 45,
          display: 'flex',
          flexDirection: 'column',
          boxShadow: sourcesOpen ? '-4px 0 16px rgba(0,0,0,0.1)' : 'none',
        }}
      >
        {sourcesOpen && (
          <div style={{ width: '300px', height: '100%', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            {globalCitations.length > 0 || Object.keys(allGlobalSources).length > 0 ? (
              <SourcesPanel
                projectId={project.id}
                citations={globalCitations}
                newSources={allGlobalSources}
                open={true}
                sidebar={true}
                activeBadgeNum={activeSourceNum}
                onClose={() => setSourcesOpen(false)}
              />
            ) : (
              <div style={{ padding: '24px 16px', textAlign: 'center' }}>
                <BookOpen size={28} color="var(--sia-medium-gray)" style={{ margin: '0 auto 10px' }} />
                <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--sia-navy)', marginBottom: '6px' }}>No sources yet</div>
                <div style={{ fontSize: '12px', color: 'var(--sia-cool-gray)', lineHeight: 1.5 }}>Run AI assessments across the pillars to populate cited and explored sources.</div>
              </div>
            )}
          </div>
        )}
      </div>
    )}
    </>
  )
}
