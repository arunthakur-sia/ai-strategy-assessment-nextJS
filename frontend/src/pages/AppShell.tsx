import React from 'react'
import { Routes, Route, useNavigate, useLocation } from 'react-router-dom'
import { useStore } from '../store/useStore'
import {
  LayoutDashboard, Settings, Search, BarChart3, GitBranch,
  Target, Download, LogOut, ChevronLeft, ChevronRight,
  Building2, Globe, BookOpen
} from 'lucide-react'
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

export default function AppShell() {
  const navigate = useNavigate()
  const location = useLocation()
  const { project, sidebarCollapsed, toggleSidebar, logout, language, setLanguage, getOverallScore, getCompletionPercent, getRag, demoMode } = useStore()

  const overallScore = getOverallScore()
  const completion = getCompletionPercent()
  const pillars = project?.assessment?.pillars || {}

  function handleLogout() {
    logout()
    navigate('/')
  }

  const isActive = (path: string) => location.pathname === path || location.pathname.startsWith(path + '/')

  return (
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
              <div style={{ width: '28px', height: '28px', borderRadius: '6px', background: 'rgba(0,222,204,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Building2 size={13} color="var(--sia-teal)" />
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: '12px', fontWeight: 600, color: 'white', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{project.entityName}</div>
                <div style={{ fontSize: '10px', color: 'var(--sia-medium-gray)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{project.name}</div>
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
  )
}
