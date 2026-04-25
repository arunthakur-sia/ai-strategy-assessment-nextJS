import { create } from 'zustand'

interface PillarElement {
  id: string
  name: string
  aiAnswer: string
  evidenceQuote: string
  sourceDocument: string
  aiScore: number | null
  manualScore: number | null
  scoreRationale: string
  notes: string
  dataGap: string | null
}

interface Pillar {
  id: string
  name: string
  description: string
  aiScore: number | null
  manualScore: number | null
  interviewScore: number | null
  finalScore: number | null
  execSummary: { aiDraft: string; edited: string; useEdited: boolean }
  elements: PillarElement[]
  swot: { strengths: string[]; weaknesses: string[]; opportunities: string[]; threats: string[] }
  interviewQuestions: string[]
  chatHistory: any[]
  status: 'not_started' | 'in_progress' | 'complete'
}

interface StrategyNode {
  id: string
  parentId: string | null
  level: number
  title: string
  description: string
  aiDraft: string
  linkedPillar: string | null
  kpis: any[]
  initiatives: any[]
  order: number
}

interface Project {
  id: string
  name: string
  entityName: string
  entityType: string
  language: string
  webEnrichmentEnabled: boolean
  interviewModeEnabled: boolean
  pillarWeights: Record<string, number>
  strategyTemplate: string
  consultantName: string
  sector?: string
  assessmentDateStart?: string
  assessmentDateEnd?: string
  createdAt: string
  updatedAt: string
  documents: any[]
  assessment: {
    pillars: Record<string, Pillar>
    consolidatedSwot: { strengths: any[]; weaknesses: any[]; opportunities: any[]; threats: any[] }
    strategicHypothesis: { aiDraft: string; edited: string }
    benchmarkData: Record<string, any>
  }
  strategy: {
    template: string
    levelNames: string[]
    nodes: StrategyNode[]
  }
  outputs: Record<string, { generated: boolean; content: string; lastGenerated: string | null }>
}

interface StoreState {
  currentProjectId: string | null
  isAuthenticated: boolean
  project: Project | null
  loading: boolean
  error: string | null
  activePillar: string
  activeTab: string
  sidebarCollapsed: boolean
  language: string
  demoMode: boolean

  setProject: (project: Project | null) => void
  setAuthenticated: (val: boolean) => void
  setLoading: (loading: boolean) => void
  setError: (error: string | null) => void
  setActivePillar: (pillarId: string) => void
  setActiveTab: (tab: string) => void
  toggleSidebar: () => void
  setLanguage: (lang: string) => void
  setDemoMode: (val: boolean) => void
  updatePillar: (pillarId: string, data: Partial<Pillar>) => void
  updateStrategyNode: (nodeId: string, data: Partial<StrategyNode>) => void
  addStrategyNode: (node: StrategyNode) => void
  deleteStrategyNode: (nodeId: string) => void
  getOverallScore: () => string | null
  getCompletionPercent: () => number
  getRag: (score: number | null | undefined) => 'red' | 'amber' | 'green' | 'gray'
  logout: () => void
}

export const useStore = create<StoreState>((set, get) => ({
  currentProjectId: null,
  isAuthenticated: false,
  project: null,
  loading: false,
  error: null,
  activePillar: 'P1',
  activeTab: 'dashboard',
  sidebarCollapsed: false,
  language: 'en',
  demoMode: false,

  setProject: (project) => set({ project, currentProjectId: project?.id ?? null }),
  setAuthenticated: (val) => set({ isAuthenticated: val }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),
  setActivePillar: (pillarId) => set({ activePillar: pillarId }),
  setActiveTab: (tab) => set({ activeTab: tab }),
  toggleSidebar: () => set(s => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  setLanguage: (lang) => set({ language: lang }),
  setDemoMode: (val) => set({ demoMode: val }),

  updatePillar: (pillarId, data) => set(s => ({
    project: s.project ? {
      ...s.project,
      assessment: {
        ...s.project.assessment,
        pillars: {
          ...s.project.assessment.pillars,
          [pillarId]: { ...s.project.assessment.pillars[pillarId], ...data }
        }
      }
    } : null
  })),

  updateStrategyNode: (nodeId, data) => set(s => {
    if (!s.project) return {}
    const nodes = s.project.strategy.nodes.map(n => n.id === nodeId ? { ...n, ...data } : n)
    return { project: { ...s.project, strategy: { ...s.project.strategy, nodes } } }
  }),

  addStrategyNode: (node) => set(s => {
    if (!s.project) return {}
    return { project: { ...s.project, strategy: { ...s.project.strategy, nodes: [...(s.project.strategy.nodes || []), node] } } }
  }),

  deleteStrategyNode: (nodeId) => set(s => {
    if (!s.project) return {}
    const nodes = s.project.strategy.nodes.filter(n => n.id !== nodeId && n.parentId !== nodeId)
    return { project: { ...s.project, strategy: { ...s.project.strategy, nodes } } }
  }),

  getOverallScore: () => {
    const { project } = get()
    if (!project) return null
    const pillars = Object.values(project.assessment.pillars)
    const scored = pillars.filter(p => p.finalScore !== null)
    if (scored.length === 0) return null
    return (scored.reduce((sum, p) => sum + (p.finalScore || 0), 0) / scored.length).toFixed(1)
  },

  getCompletionPercent: () => {
    const { project } = get()
    if (!project) return 0
    const pillars = Object.values(project.assessment.pillars)
    const complete = pillars.filter(p => p.status === 'complete').length
    return Math.round((complete / pillars.length) * 100)
  },

  getRag: (score) => {
    if (score === null || score === undefined) return 'gray'
    if (score < 2.5) return 'red'
    if (score < 3.5) return 'amber'
    return 'green'
  },

  logout: () => set({ project: null, currentProjectId: null, isAuthenticated: false }),
}))
