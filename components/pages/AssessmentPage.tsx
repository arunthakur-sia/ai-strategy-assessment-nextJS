'use client'
import React, { useState, useRef, useEffect } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useStore } from '@/store/useStore'
import { projectsApi, aiApi } from '@/lib/api'
import { startPillarAssessment, startBatchAssessment } from '@/services/assessmentService'
import { CitedText, type Citation } from '@/components/CitedText'
import { Play, CheckCircle, Loader2, ChevronDown, ChevronUp, Edit3, Save, X, MessageSquare, AlertCircle, Send, BarChart2, BookOpen, RefreshCw, ExternalLink } from 'lucide-react'

const PILLAR_COLORS: Record<string, string> = { P1:'#00DECC',P2:'#077C84',P3:'#10B981',P4:'#3B82F6',P5:'#8B5CF6',P6:'#F59E0B',P7:'#EF4444',P8:'#EC4899' }
const PILLAR_ICONS: Record<string, string> = { P1:'🎯',P2:'🏛',P3:'💰',P4:'🗺',P5:'⚙️',P6:'👥',P7:'🛡',P8:'🚀' }
const RAG_COLORS: Record<string, string> = { red: 'var(--sia-red)', amber: 'var(--sia-amber)', green: 'var(--sia-green)', gray: 'var(--sia-medium-gray)' }
const RAG_LABELS: Record<string, string> = { red: 'Critical', amber: 'Developing', green: 'Strong', gray: 'Not Assessed' }

const GRADING_BANDS = [
  { range: '4.5–5.0', label: 'Excellent', color: '#059669', bg: '#ECFDF5', desc: 'Sector-leading best-in-class practice' },
  { range: '3.5–4.4', label: 'Strong', color: '#10B981', bg: '#F0FDF4', desc: 'Well-developed, above sector average' },
  { range: '2.5–3.4', label: 'Developing', color: '#F59E0B', bg: '#FFFBEB', desc: 'Functional but inconsistent. Needs improvement' },
  { range: '1.5–2.4', label: 'Weak', color: '#EF4444', bg: '#FEF2F2', desc: 'Ad-hoc and inconsistent. Significant gaps' },
  { range: '1.0–1.4', label: 'Critical', color: '#991B1B', bg: '#FEF2F2', desc: 'Element absent or severely underdeveloped' },
]

const ELEMENT_QUESTIONS: Record<string, string[]> = {
  'Mission & Vision Clarity': ['Is the mission clearly articulated and differentiated from peers?', 'Does leadership actively reference the vision in decisions?', 'Is the vision inspiring and understood at all levels?'],
  'Strategic Intent': ['What is the 3-5 year ambition and is it SMART and time-bound?', 'Is there a clear theory of change linking activities to outcomes?', 'How is strategic intent cascaded across the organization?'],
  'Value Proposition': ['What unique value does the entity deliver to its stakeholders?', 'Is the value proposition differentiated from alternatives?', 'Is the value prop consistently understood and delivered across departments?'],
  'Strategic Coherence': ['Do vision, strategy, and execution align in practice?', 'Are there contradictions between stated and actual strategic priorities?', 'Is resource allocation consistent with stated strategic priorities?'],
  'Parenting Purpose': ["What is the holding's theory of value creation for subsidiaries?", 'How does the parent concretely add value beyond capital provision?', 'Is the parenting model primarily financial, strategic, or operational?'],
  'Board Composition & Effectiveness': ["What is the board's composition and independence level?", 'How frequently does the board meet and what key decisions does it review?', 'Does the board have the strategic and sector expertise required?'],
  'Leadership Team Capability': ['Does the leadership team have the right mix of strategic and operational experience?', 'What leadership development programs are in place?', 'How is leadership performance evaluated and held accountable?'],
  'Decision-Making Architecture': ['How are strategic decisions made and by whom?', 'What is the speed of decision-making for operational vs strategic issues?', 'Are there clear delegation of authority frameworks in place?'],
  'Parenting Style': ['How does the parent entity engage with its subsidiaries?', 'Is oversight primarily through governance, performance, or operations?', 'What degree of autonomy do subsidiaries have in strategy and operations?'],
  'Accountability & Performance Management': ['Are performance targets cascaded from strategy to individual KPIs?', 'How frequently is performance reviewed against targets?', 'What are the consequences of sustained underperformance?'],
  'Revenue Trajectory': ['What is the revenue growth rate over the last 3-5 years?', 'How diversified are revenue streams across products, markets, and clients?', 'What are the key drivers and risks to future revenue growth?'],
  'Profitability Analysis': ['What are the gross and net profit margins vs sector peers?', 'Where are the main sources of profitability and margin erosion?', 'What is the EBITDA trend over the last 3 years?'],
  'Liquidity & Solvency': ['What is the current ratio and quick ratio?', 'What is the debt-to-equity ratio and how has it changed?', 'Is there adequate liquidity to meet 12-24 month obligations?'],
  'Cash Flow Quality': ['What is the ratio of operating cash flow to net income?', 'Are there significant non-cash items inflating reported earnings?', 'How consistently does the entity convert revenue to cash?'],
  'Capital Allocation Efficiency': ['What is the return on invested capital (ROIC)?', 'How are capital allocation decisions made and prioritized?', 'What is the track record of capital projects delivering expected returns?'],
  'Portfolio Financial Contribution': ['What is the financial contribution of each subsidiary to the group?', 'Are there portfolio entities that are consistently loss-making?', 'How is inter-company pricing and value transfer managed?'],
  'Market Size & Growth': ['What is the size and growth rate of the addressable market?', 'What are the key macro drivers shaping this market over 3-5 years?', 'Is the entity positioned in high-growth or declining market segments?'],
  'Market Share & Positioning': ["What is the entity's estimated market share and trend over 3 years?", 'How is the entity perceived relative to its top 3 competitors?', 'Is the entity a market leader, challenger, or niche player?'],
  "Competitive Dynamics (Porter's 5 Forces)": ['Who are the top 3-5 competitors and what are their strategies?', 'What are the barriers to entry for new competitors?', 'Is competitive intensity increasing or decreasing and why?'],
  'Customer Concentration & Satisfaction': ['What percentage of revenue comes from the top 5 clients?', 'What are the customer satisfaction scores and trend?', 'What is the customer retention/churn rate?'],
  'Competitive Advantage': ["What is the entity's primary source of competitive advantage?", 'How sustainable and defensible is this advantage over 5+ years?', 'What would erode this advantage and how is it being protected?'],
  'Portfolio Synergies': ['Do portfolio entities share clients, capabilities, or markets?', 'Are there measurable financial or operational synergies being realized?', 'Is the portfolio greater than the sum of its parts?'],
  'Core Competencies': ['What are the 2-3 activities the entity does better than any competitor?', 'Are these competencies explicit, codified, and continuously developed?', 'How are core competencies leveraged across products or business units?'],
  'Operational Efficiency': ['What are the main KPIs tracking operational performance?', 'How do operational costs compare to sector benchmarks?', 'Are there documented process improvement programs in place?'],
  'Technology & Digital Maturity': ['What is the current digital maturity level across key operations?', 'What are the highest-priority technology investment areas?', 'Is there a comprehensive digital transformation roadmap with executive sponsorship?'],
  'Supply Chain & Partnerships': ['How resilient and diversified is the supply chain?', 'What are the key strategic partnerships and their value contribution?', 'What is the risk exposure from single-source dependencies?'],
  'Innovation Capability': ['What percentage of revenue is invested in R&D or innovation?', 'How many new products, services, or processes were launched in the last 3 years?', 'Is there a formal innovation process and dedicated innovation team?'],
  'Shared Services & Synergies': ['Are there shared service centers across the portfolio?', 'What functions are centralized vs decentralized across subsidiaries?', 'Are there measurable cost savings from shared services?'],
  'Organizational Structure': ['Is the organizational structure fit for the current strategy?', 'How many management layers exist from CEO to frontline?', 'Are roles and responsibilities clearly defined with clear accountability?'],
  'Talent & Skills': ['What are the critical skill gaps relative to the strategic plan?', 'What is the turnover rate for high-performing employees?', 'Is there a formal succession plan for key leadership positions?'],
  'Culture & Values': ['Are organizational values explicitly defined and actively practiced?', 'How is culture measured and reinforced through HR practices?', 'Is there alignment between stated culture and observed behaviors?'],
  'Employee Engagement': ['What is the employee engagement or satisfaction score?', 'What are the top 3 drivers of employee satisfaction and dissatisfaction?', 'What initiatives are in place to improve engagement?'],
  'Change Readiness': ['How has the organization responded to major change initiatives historically?', 'Is there a formal change management capability or center of excellence?', 'What is the level of leadership commitment to ongoing transformation?'],
  'Strategic Risks': ['What are the top 3 strategic risks that could derail the entity\'s vision?', 'Is there a formal risk register reviewed at board level?', 'How are strategic risks monitored and mitigated?'],
  'Operational Risks': ['What are the key operational risks and their likelihood/impact assessment?', 'Are there documented business continuity plans for critical operations?', 'What near-miss incidents or operational failures occurred in the last 2 years?'],
  'Financial Risks': ['What is the exposure to interest rate, currency, or commodity risk?', 'Is there adequate insurance coverage for key financial risks?', 'What stress testing has been done on the financial model?'],
  'Regulatory & Compliance': ['What are the key regulatory requirements and is the entity fully compliant?', 'What regulatory changes are expected in the next 2-3 years?', 'Are there any pending regulatory investigations or penalties?'],
  'ESG & Sustainability': ['Does the entity have a formal ESG strategy and targets?', 'What are the key environmental risks and how are they being addressed?', 'How is ESG performance reported to internal and external stakeholders?'],
  'Organic Growth Vectors': ['What are the top 3 organic growth opportunities identified by leadership?', 'Are there untapped customer segments or geographies for existing products?', 'Is there a pipeline of new products or services in development?'],
  'Inorganic Growth': ['Is there an active M&A strategy with a defined target profile?', 'What acquisitions or JVs have been completed in the last 5 years?', 'Does the entity have balance sheet capacity and integration capability for M&A?'],
  'Digital & AI Opportunities': ['What are the top 3 ways AI/digital technology could transform operations or revenue?', 'Are there pilot programs or proofs of concept underway for AI/digital?', "What is the entity's capability to attract and retain digital/AI talent?"],
  'Blue Ocean Opportunities': ['Are there uncontested market spaces where the entity could create unique value?', 'What customer needs are currently unmet or underserved in the market?', 'Could the entity reconfigure its value chain to access an entirely new market?'],
  'Parenting Advantage Opportunities': ['How can the parent entity create more value for its portfolio companies?', 'Are there portfolio synergies not currently being exploited?', 'Could the entity acquire new capabilities that benefit all subsidiaries?'],
  'Working Capital Management': ['What is the current ratio and cash conversion cycle trend over the last 3 years?', 'How is working capital optimized across subsidiaries and business units?', 'Are there active initiatives to improve receivables, payables, or inventory cycles?'],
  'Portfolio Optimization': ['How does the entity evaluate the strategic fit of each portfolio company using BCG matrix or similar frameworks?', 'Which subsidiaries are candidates for divestment, and what is the planned exit strategy?', 'Is there a formal portfolio review process with clear criteria for invest, hold, or exit decisions?'],
}

const RESOURCES_BY_PILLAR: Record<string, Array<{icon:string,name:string,type:string,desc:string,docCode?:string}>> = {
  P1: [
    {icon:'📄',name:'Strategy Document (M1)',type:'Internal',desc:'Corporate strategy plan',docCode:'M1'},
    {icon:'📄',name:'Board Presentations (O1)',type:'Internal',desc:'Strategic direction',docCode:'O1'},
    {icon:'🌐',name:'McKinsey Strategy Frameworks',type:'External',desc:'Best practice frameworks'},
    {icon:'📊',name:'GCC Government Strategy Reports',type:'External',desc:'Regional benchmarks'},
  ],
  P2: [
    {icon:'📄',name:'Governance Documents (O2)',type:'Internal',desc:'Board charter, Terms of Reference',docCode:'O2'},
    {icon:'📄',name:'Org Chart (M3)',type:'Internal',desc:'Reporting structure',docCode:'M3'},
    {icon:'🌐',name:'OECD Corporate Governance Guidelines',type:'External',desc:'International framework'},
    {icon:'🌐',name:'GCC Governance Index',type:'External',desc:'Regional benchmark'},
  ],
  P3: [
    {icon:'📄',name:'Financial Statements (M2)',type:'Internal',desc:'P&L, Balance Sheet',docCode:'M2'},
    {icon:'📄',name:'Budget Plans (O8)',type:'Internal',desc:'Financial forecasts',docCode:'O8'},
    {icon:'🌐',name:'IMF/World Bank Financial Data',type:'External',desc:'Macro context'},
    {icon:'📊',name:'Sector Financial Benchmarks',type:'External',desc:'Peer comparison data'},
  ],
  P4: [
    {icon:'📄',name:'Market/Industry Reports (O4)',type:'Internal',desc:'Market research',docCode:'O4'},
    {icon:'🌐',name:'Qatar Planning & Statistics Authority',type:'External',desc:'Official government data'},
    {icon:'🌐',name:'World Economic Forum Competitiveness',type:'External',desc:'Global competitiveness rankings'},
    {icon:'📊',name:'GCC Market Intelligence Reports',type:'External',desc:'Regional market data'},
  ],
  P5: [
    {icon:'📄',name:'Operational Reports (O7)',type:'Internal',desc:'Process documentation',docCode:'O7'},
    {icon:'📄',name:'KPI Dashboards (O3)',type:'Internal',desc:'Performance metrics',docCode:'O3'},
    {icon:'🌐',name:'Gartner Operational Maturity Models',type:'External',desc:'Operational frameworks'},
    {icon:'🌐',name:'ISO Standards References',type:'External',desc:'International best practice'},
  ],
  P6: [
    {icon:'📄',name:'HR/People Data (O5)',type:'Internal',desc:'Headcount, talent data',docCode:'O5'},
    {icon:'📄',name:'Org Chart (M3)',type:'Internal',desc:'Organizational structure',docCode:'M3'},
    {icon:'🌐',name:'LinkedIn Talent Insights',type:'External',desc:'Talent market data'},
    {icon:'🌐',name:'Mercer HR Benchmarks GCC',type:'External',desc:'Compensation and talent benchmarks'},
  ],
  P7: [
    {icon:'📄',name:'Risk Registers (O6)',type:'Internal',desc:'Enterprise risk register',docCode:'O6'},
    {icon:'📄',name:'ESG Reports (E2)',type:'Internal',desc:'Sustainability reporting',docCode:'E2'},
    {icon:'🌐',name:'World Bank Governance Indicators',type:'External',desc:'Governance and risk context'},
    {icon:'🌐',name:'Qatar National Risk Assessment',type:'External',desc:'Country risk assessment'},
  ],
  P8: [
    {icon:'📄',name:'Strategy Document (M1)',type:'Internal',desc:'Growth plans and options',docCode:'M1'},
    {icon:'📄',name:'M&A Documents (E4)',type:'Internal',desc:'Corporate development pipeline',docCode:'E4'},
    {icon:'🌐',name:'BCG/McKinsey Growth Frameworks',type:'External',desc:'Strategic growth methodology'},
    {icon:'🌐',name:'GCC FDI Reports',type:'External',desc:'Investment landscape data'},
  ],
}

const STARTER_PROMPTS = [
  'Challenge this score — is it too high or too low?',
  'What evidence would change the score to a 5?',
  'What are we missing in the documents?',
  'Generate 3 additional interview questions',
  'How does this compare to GCC best practice?',
  'Summarize findings in an executive brief',
]

export default function AssessmentPage() {
  const { project, setProject, activePillar, setActivePillar, getRag, activeEntityId, setSourcesOpen, setActiveSourceNum,
    assessmentRunning, assessmentRunningPillars } = useStore()
  const [streamText, setStreamText] = useState('')
  const [assessError, setAssessError] = useState<string | null>(null)
  const [expandedSections, setExpandedSections] = useState({ summary: true, elements: true, swot: false, questions: true, benchmarks: false, chat: false })
  const [editingSummary, setEditingSummary] = useState(false)
  const [summaryEdit, setSummaryEdit] = useState('')
  const [chatInput, setChatInput] = useState('')
  const [chatMessages, setChatMessages] = useState<any[]>([])
  const [chatStreaming, setChatStreaming] = useState(false)
  const [interviewTab, setInterviewTab] = useState<'leadership'|'team'|'gapFilling'>('leadership')
  const [expandedQuestions, setExpandedQuestions] = useState<Record<string, boolean>>({})
  const [loadingBenchmarks, setLoadingBenchmarks] = useState(false)
  const chatEndRef = useRef<HTMLDivElement>(null)
  const [selectedPillars, setSelectedPillars] = useState<Set<string>>(new Set())

  // Derived from store — persists across navigation
  const running = assessmentRunning && Object.keys(assessmentRunningPillars).length === 0
  const multiRunActive = assessmentRunning && Object.keys(assessmentRunningPillars).length > 0
  const runningPillars = assessmentRunningPillars

  if (!project) return null

  const activeEntity = activeEntityId ? (project.entities || []).find((e: any) => e.id === activeEntityId) : null
  const pillars = activeEntity ? activeEntity.assessment.pillars : project.assessment.pillars
  const effectiveDocuments: any[] = activeEntity ? (activeEntity.documents || []) : (project.documents || [])
  const pillar = (pillars as any)[activePillar]

  useEffect(() => {
    setChatMessages(pillar?.chatHistory || [])
    setInterviewTab('leadership')
    setExpandedQuestions({})
    setActiveSourceNum(null)
  }, [activePillar, activeEntityId])

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [chatMessages])

  async function savePillar(data: any) {
    if (activeEntity) {
      await projectsApi.updateEntityPillar(project!.id, activeEntity.id, activePillar, data)
    } else {
      await projectsApi.updatePillar(project!.id, activePillar, data)
    }
    const res = await projectsApi.get(project!.id)
    setProject(res.data)
  }

  async function runAssessment() {
    if (effectiveDocuments.length === 0) {
      setAssessError(`No documents uploaded${activeEntity ? ` for ${activeEntity.name}` : ''}. Upload documents first before running an assessment.`)
      return
    }
    setStreamText('')
    setAssessError(null)
    startPillarAssessment(
      project!.id,
      activeEntity?.id ?? null,
      activePillar,
      {
        onChunk: (chunk) => setStreamText(prev => prev + chunk),
        onDone: () => setStreamText(''),
        onError: (err) => { setAssessError(err); setStreamText('') },
      }
    )
  }

  async function saveSummary() {
    const updated = { ...pillar, execSummary: { ...pillar.execSummary, edited: summaryEdit, useEdited: true } }
    await savePillar(updated)
    setEditingSummary(false)
  }

  async function saveElementNote(elemIdx: number, field: string, value: any) {
    const elements = [...pillar.elements]
    elements[elemIdx] = { ...elements[elemIdx], [field]: value }
    await savePillar({ elements })
  }

  async function updateFinalScore(overrides: Partial<{ aiScore: number; manualScore: number; interviewScore: number }> = {}) {
    const ai = overrides.aiScore ?? pillar.aiScore ?? 0
    const manual = overrides.manualScore ?? pillar.manualScore ?? 0
    const interview = overrides.interviewScore ?? pillar.interviewScore ?? 0
    let count = 0, sum = 0
    if (ai > 0) { sum += ai; count++ }
    if (manual > 0) { sum += manual * 1.2; count += 1.2 }
    if (interview > 0) { sum += interview; count++ }
    const final = count > 0 ? Math.min(5, Math.max(1, sum / count)) : null
    await savePillar({ ...overrides, finalScore: final ? parseFloat(final.toFixed(2)) : null })
  }

  async function sendChat() {
    if (!chatInput.trim() || chatStreaming) return
    const userMsg = { role: 'user', content: chatInput, timestamp: new Date().toISOString() }
    const newMessages = [...chatMessages, userMsg]
    setChatMessages(newMessages)
    setChatInput('')
    setChatStreaming(true)
    let aiText = ''
    setChatMessages((msgs: any[]) => [...msgs, { role: 'assistant', content: '', streaming: true }])
    try {
      for await (const data of aiApi.chat(project!.id, newMessages, { pillarId: activePillar })) {
        if (data.chunk) {
          aiText += data.chunk
          setChatMessages((msgs: any[]) => msgs.map((m: any, i: number) => i === msgs.length - 1 ? { ...m, content: aiText } : m))
        }
        if (data.done) setChatMessages((msgs: any[]) => msgs.map((m: any, i: number) => i === msgs.length - 1 ? { ...m, streaming: false } : m))
      }
    } catch (e) {}
    const finalHistory = [...newMessages, { role: 'assistant', content: aiText, timestamp: new Date().toISOString() }]
    try {
      await savePillar({ chatHistory: finalHistory })
    } catch (e) {}
    setChatStreaming(false)
  }

  async function loadBenchmarks() {
    setLoadingBenchmarks(true)
    try {
      await aiApi.benchmarks(project!.id, activePillar, activeEntityId)
      const updated = await projectsApi.get(project!.id)
      setProject(updated.data)
      setExpandedSections(prev => ({ ...prev, benchmarks: true }))
    } catch (e: any) {
      alert('Failed to load benchmarks: ' + (e.response?.data?.error || e.message))
    }
    setLoadingBenchmarks(false)
  }

  function togglePillarSelection(id: string) {
    setSelectedPillars(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleSelectAll() {
    if (selectedPillars.size === Object.keys(pillars).length) {
      setSelectedPillars(new Set())
    } else {
      setSelectedPillars(new Set(Object.keys(pillars)))
    }
  }

  async function runMultipleAssessments() {
    const ids = Array.from(selectedPillars)
    if (ids.length === 0) return
    if (effectiveDocuments.length === 0) {
      setAssessError(`No documents uploaded${activeEntity ? ` for ${activeEntity.name}` : ''}. Upload documents before running assessments.`)
      return
    }
    setAssessError(null)
    startBatchAssessment(
      project!.id,
      activeEntity?.id ?? null,
      ids,
      {
        onDone: (failedIds) => {
          if (failedIds.length > 0) {
            // project already refreshed in store by service — read pillar names from store
            const pillarMap = activeEntity
              ? (useStore.getState().project?.entities || []).find((e: any) => e.id === activeEntity.id)?.assessment?.pillars
              : useStore.getState().project?.assessment?.pillars
            const names = failedIds.map((id: string) => {
              const p = pillarMap?.[id]
              return p ? `${id} · ${p.name}` : id
            }).join(', ')
            setAssessError(
              `${failedIds.length} pillar${failedIds.length > 1 ? 's' : ''} failed after retries: ${names}. Select them individually and click "Run AI Assessment" to retry.`
            )
          }
        },
        onError: (err) => setAssessError(err),
      }
    )
  }

  const rag = getRag(pillar.finalScore)
  function toggle(section: string) { setExpandedSections((s: any) => ({ ...s, [section]: !s[section] })) }
  function toggleQuestion(elemId: string) { setExpandedQuestions(q => ({ ...q, [elemId]: !q[elemId] })) }

  const swotConfig = [
    { key: 'strengths', label: 'Strengths', cls: 'swot-strengths', color: '#065F46' },
    { key: 'weaknesses', label: 'Weaknesses', cls: 'swot-weaknesses', color: '#991B1B' },
    { key: 'opportunities', label: 'Opportunities', cls: 'swot-opportunities', color: '#1E40AF' },
    { key: 'threats', label: 'Threats', cls: 'swot-threats', color: '#92400E' },
  ]

  const iqData = pillar.interviewQuestions
  const isNewIQFormat = iqData && !Array.isArray(iqData) && (iqData.leadership || iqData.team || iqData.gapFilling)
  const hasAnyIQ = isNewIQFormat
    ? ((iqData.leadership?.length || 0) + (iqData.team?.length || 0) + (iqData.gapFilling?.length || 0)) > 0
    : (Array.isArray(iqData) && iqData.length > 0)

  const benchmarkData = pillar.benchmarkData

  const resources = RESOURCES_BY_PILLAR[activePillar] || []
  function isDocUploaded(docCode?: string) {
    if (!docCode) return false
    return effectiveDocuments.some((d: any) =>
      d.name?.toLowerCase().includes(docCode.toLowerCase()) || d.label?.toLowerCase().includes(docCode.toLowerCase())
    )
  }

  function renderBullets(text: string, onCiteClick?: (c: Citation) => void) {
    if (!text) return null
    const lines = text.split('\n').filter(Boolean)
    return (
      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '4px' }}>
        {lines.map((line, i) => (
          <li key={i} style={{ display: 'flex', gap: '8px', alignItems: 'flex-start', fontSize: '13px', color: 'var(--sia-cool-gray)', lineHeight: 1.55 }}>
            <span style={{ color: 'var(--sia-teal)', flexShrink: 0, fontWeight: 700, marginTop: '1px' }}>•</span>
            {onCiteClick
              ? <CitedText text={line.replace(/^•\s*/, '')} onCiteClick={onCiteClick} />
              : <span>{line.replace(/^•\s*/, '')}</span>}
          </li>
        ))}
      </ul>
    )
  }

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden', position: 'relative' }}>

      {/* Pillar Navigation */}
      <div style={{ width: '220px', background: 'white', borderRight: '1px solid rgba(69,85,105,0.1)', overflow: 'auto', flexShrink: 0, display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '16px 12px 10px' }}>
          <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--sia-medium-gray)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '10px' }}>Assessment Pillars</div>
          {/* Multi-run controls */}
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
            <button
              onClick={toggleSelectAll}
              style={{ fontSize: '10px', padding: '4px 8px', border: '1px solid rgba(69,85,105,0.2)', borderRadius: '4px', background: 'white', cursor: 'pointer', color: 'var(--sia-cool-gray)', whiteSpace: 'nowrap', flexShrink: 0 }}>
              {selectedPillars.size === Object.keys(pillars).length ? 'Clear' : 'All'}
            </button>
            <button
              onClick={runMultipleAssessments}
              disabled={selectedPillars.size === 0 || multiRunActive}
              style={{ flex: 1, fontSize: '10px', padding: '4px 8px', border: 'none', borderRadius: '4px', background: selectedPillars.size > 0 ? 'var(--sia-teal)' : 'var(--sia-light-gray)', cursor: selectedPillars.size === 0 || multiRunActive ? 'not-allowed' : 'pointer', color: selectedPillars.size > 0 ? 'white' : 'var(--sia-medium-gray)', fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px', opacity: multiRunActive ? 0.75 : 1, transition: 'all 0.15s' }}>
              {multiRunActive
                ? <><Loader2 size={10} className="spinner" /> Running…</>
                : <><Play size={10} /> {selectedPillars.size > 0 ? `Run ${selectedPillars.size} Pillar${selectedPillars.size > 1 ? 's' : ''}` : 'Run Selected'}</>}
            </button>
          </div>
          {multiRunActive && (
            <div style={{ marginTop: '8px', fontSize: '10px', color: 'var(--sia-teal)', fontWeight: 600 }}>
              {Object.values(runningPillars).filter(s => s === 'done').length}/{Object.keys(runningPillars).length} complete
            </div>
          )}
        </div>
        {Object.entries(pillars).map(([id, p]: [string, any]) => {
          const prag = getRag(p.finalScore)
          const active = activePillar === id
          const isSelected = selectedPillars.has(id)
          const runStatus = runningPillars[id]
          return (
            <div key={id} style={{ display: 'flex', alignItems: 'center', borderLeft: `3px solid ${active ? PILLAR_COLORS[id] : 'transparent'}`, background: active ? 'rgba(0,222,204,0.08)' : 'transparent', transition: 'background 0.15s' }}>
              <input
                type="checkbox"
                checked={isSelected}
                onChange={() => togglePillarSelection(id)}
                style={{ marginLeft: '10px', flexShrink: 0, cursor: 'pointer', accentColor: 'var(--sia-teal)', width: '13px', height: '13px' }}
              />
              <button data-testid={`pillar-nav-${id}`} onClick={() => setActivePillar(id)}
                style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 10px 10px 8px', background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left' }}
              >
                <span style={{ fontSize: '15px', flexShrink: 0 }}>{PILLAR_ICONS[id]}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '11px', fontWeight: 700, color: active ? 'var(--sia-navy)' : 'var(--sia-cool-gray)', marginBottom: '2px' }}>{id}</div>
                  <div style={{ fontSize: '10px', color: active ? 'var(--sia-cool-gray)' : 'var(--sia-medium-gray)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{(p as any).name.split(' ').slice(0, 3).join(' ')}</div>
                </div>
                <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '2px' }}>
                  {runStatus === 'running' && <Loader2 size={12} color="var(--sia-teal)" className="spinner" />}
                  {runStatus === 'done' && <CheckCircle size={12} color="var(--sia-green)" />}
                  {runStatus === 'error' && <AlertCircle size={12} color="var(--sia-red)" />}
                  {!runStatus && (p as any).finalScore && <span style={{ fontFamily: 'var(--font-display)', fontSize: '13px', fontWeight: 700, color: RAG_COLORS[prag] }}>{(p as any).finalScore.toFixed(1)}</span>}
                  {!runStatus && (p as any).status === 'complete' && <CheckCircle size={10} color="var(--sia-green)" />}
                </div>
              </button>
            </div>
          )
        })}
      </div>

      {/* Main Content */}
      <div style={{ flex: 1, overflow: 'auto', padding: '28px 32px', paddingRight: '32px' }}>

        {/* Entity context banner */}
        {activeEntity && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 14px', background: 'rgba(139,92,246,0.08)', border: '1px solid rgba(139,92,246,0.25)', borderRadius: '8px', marginBottom: '16px' }}>
            <div style={{ width: '22px', height: '22px', borderRadius: '5px', background: 'rgba(139,92,246,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <span style={{ fontSize: '11px' }}>🏢</span>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <span style={{ fontSize: '12px', fontWeight: 700, color: '#6D28D9' }}>{activeEntity.name}</span>
              <span style={{ fontSize: '12px', color: '#7C3AED', marginLeft: '6px' }}>· Subsidiary Entity View</span>
            </div>
            <span style={{ fontSize: '11px', color: '#8B5CF6', background: 'rgba(139,92,246,0.1)', padding: '2px 8px', borderRadius: '4px', fontWeight: 600 }}>
              {effectiveDocuments.length} doc{effectiveDocuments.length !== 1 ? 's' : ''}
            </span>
          </div>
        )}

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '24px' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '16px' }}>
            <div style={{ width: '52px', height: '52px', borderRadius: '12px', background: `${PILLAR_COLORS[activePillar]}20`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '24px', flexShrink: 0 }}>{PILLAR_ICONS[activePillar]}</div>
            <div>
              <div style={{ fontSize: '11px', color: 'var(--sia-medium-gray)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '4px' }}>{activePillar}</div>
              <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '22px', fontWeight: 800, color: 'var(--sia-navy)', marginBottom: '4px' }}>{pillar.name}</h2>
              <div style={{ fontSize: '13px', color: 'var(--sia-cool-gray)' }}>{pillar.description}</div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: '40px', fontWeight: 800, color: RAG_COLORS[rag], lineHeight: 1 }}>{pillar.finalScore?.toFixed(1) || '—'}</div>
              <div style={{ fontSize: '11px', fontWeight: 600, color: RAG_COLORS[rag], textTransform: 'uppercase' }}>{RAG_LABELS[rag]}</div>
            </div>
            <button className="btn btn-primary" data-testid="button-run-assessment" onClick={runAssessment} disabled={running}>
              {running ? <><Loader2 size={14} className="spinner" /> Assessing...</> : <><Play size={14} /> Run AI Assessment</>}
            </button>
          </div>
        </div>

        {/* Document Status Banner — non-collapsible */}
        {(() => {
          const noDocuments = effectiveDocuments.length === 0
          const poorExtraction = effectiveDocuments.filter((d: any) => !d.extractedText || d.extractedText.length < 100)
          if (noDocuments) return (
            <div data-testid="pillar-doc-banner-empty" style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', padding: '12px 16px', background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: '8px', marginBottom: '16px' }}>
              <AlertCircle size={15} color="#D97706" style={{ flexShrink: 0, marginTop: '1px' }} />
              <div style={{ fontSize: '13px', color: '#92400E', lineHeight: 1.5 }}>
                <strong>No documents uploaded{activeEntity ? ` for ${activeEntity.name}` : ''}.</strong> The AI requires source documents to assess this pillar.{' '}
                {!activeEntity && <a href="/app/setup" style={{ color: '#D97706', fontWeight: 600 }}>Upload in Project Setup →</a>}
              </div>
            </div>
          )
          if (poorExtraction.length > 0) return (
            <div data-testid="pillar-doc-banner-warning" style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', padding: '12px 16px', background: '#FFF7ED', border: '1px solid #FDBA74', borderRadius: '8px', marginBottom: '16px' }}>
              <AlertCircle size={15} color="#EA580C" style={{ flexShrink: 0, marginTop: '1px' }} />
              <div style={{ fontSize: '12px', color: '#9A3412', lineHeight: 1.5 }}>
                <strong>{poorExtraction.length} document{poorExtraction.length > 1 ? 's' : ''} extracted little or no text:</strong>{' '}
                {poorExtraction.map((d: any) => d.name).join(', ')} — assessment quality may be affected.
              </div>
            </div>
          )
          return null
        })()}

        {running && streamText && (
          <div style={{ background: 'rgba(0,222,204,0.06)', border: '1px solid rgba(0,222,204,0.2)', borderRadius: 'var(--radius)', padding: '12px 16px', marginBottom: '20px', fontSize: '12px', color: 'var(--sia-dark-teal)', fontFamily: 'monospace', maxHeight: '80px', overflow: 'hidden', lineHeight: 1.5 }}>
            {streamText.substring(streamText.length - 400)}
            <span className="streaming" />
          </div>
        )}

        {assessError && (
          <div data-testid="assessment-error-banner" style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: '8px', padding: '12px 16px', marginBottom: '16px', fontSize: '13px', color: '#991B1B', display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
            <span style={{ flexShrink: 0, fontSize: '15px' }}>⚠️</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, marginBottom: '4px' }}>Assessment error: {assessError}</div>
              <div style={{ fontSize: '12px', opacity: 0.8 }}>Check that your documents were uploaded correctly and try again.</div>
            </div>
            <button onClick={() => setAssessError(null)} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: '#991B1B', flexShrink: 0, padding: '0 4px', fontSize: '16px', lineHeight: 1 }}>×</button>
          </div>
        )}

        {/* Score Breakdown */}
        {(pillar.aiScore || pillar.manualScore) && (
          <div className="card" style={{ padding: '20px 24px', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '24px', flexWrap: 'wrap' }}>
            <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--sia-cool-gray)' }}>Score Breakdown</div>
            {[
              { label: 'AI Score', value: pillar.aiScore, field: 'aiScore', readOnly: true },
              { label: 'Manual Override', value: pillar.manualScore, field: 'manualScore', readOnly: false },
              ...(project.interviewModeEnabled ? [{ label: 'Interview Score', value: pillar.interviewScore, field: 'interviewScore', readOnly: false }] : []),
            ].map(s => (
              <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '12px', color: 'var(--sia-medium-gray)' }}>{s.label}</span>
                <input key={`${activePillar}-${activeEntityId || 'main'}-${s.field}`} type="number" min="1" max="5" step="0.5" disabled={s.readOnly}
                  defaultValue={s.value || ''}
                  placeholder="—"
                  onBlur={async e => {
                    if (!s.readOnly && e.target.value) {
                      await updateFinalScore({ [s.field]: parseFloat(e.target.value) })
                    }
                  }}
                  style={{ width: '60px', padding: '6px 8px', border: `1px solid ${s.readOnly ? 'transparent' : 'rgba(69,85,105,0.2)'}`, borderRadius: '6px', fontFamily: 'var(--font-display)', fontSize: '16px', fontWeight: 700, color: 'var(--sia-navy)', background: s.readOnly ? 'var(--sia-light-gray)' : 'white', textAlign: 'center' }}
                />
              </div>
            ))}
            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '12px', color: 'var(--sia-medium-gray)' }}>Final Score</span>
              <span style={{ fontFamily: 'var(--font-display)', fontSize: '24px', fontWeight: 800, color: RAG_COLORS[rag] }}>{pillar.finalScore?.toFixed(1) || '—'}</span>
              <span className={`rag-badge rag-${rag}`}>{RAG_LABELS[rag]}</span>
            </div>
          </div>
        )}

        {/* Missing Information Warning */}
        {pillar.missingInfo?.length > 0 && (
          <div style={{ marginBottom: '16px', background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: '8px', overflow: 'hidden' }}>
            <div style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: '10px', borderBottom: '1px solid #FDE68A' }}>
              <AlertCircle size={15} color="#92400E" />
              <span style={{ fontSize: '13px', fontWeight: 600, color: '#92400E' }}>Missing Information Detected ({pillar.missingInfo.length} items)</span>
              <span style={{ fontSize: '11px', color: '#B45309', marginLeft: '4px' }}>These gaps may affect assessment accuracy</span>
            </div>
            <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {pillar.missingInfo.map((mi: any, i: number) => (
                <div key={i} style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
                  <span style={{ fontSize: '10px', fontWeight: 700, padding: '2px 6px', borderRadius: '4px', background: mi.priority === 'high' ? '#FEE2E2' : mi.priority === 'medium' ? '#FEF3C7' : '#F1F5F9', color: mi.priority === 'high' ? '#991B1B' : mi.priority === 'medium' ? '#92400E' : 'var(--sia-cool-gray)', textTransform: 'uppercase', flexShrink: 0, marginTop: '1px' }}>{mi.priority}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '12px', fontWeight: 600, color: '#92400E', marginBottom: '2px' }}><CitedText text={mi.item} onCiteClick={c => { setActiveSourceNum(c.num); setSourcesOpen(true) }} /></div>
                    <div style={{ fontSize: '11px', color: '#B45309' }}><CitedText text={mi.impact} onCiteClick={c => { setActiveSourceNum(c.num); setSourcesOpen(true) }} /> — <em>Suggested source: <CitedText text={mi.suggestedSource} onCiteClick={c => { setActiveSourceNum(c.num); setSourcesOpen(true) }} /></em></div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Executive Summary */}
        <div className="card" style={{ marginBottom: '12px', overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', cursor: 'pointer', borderBottom: expandedSections.summary ? '1px solid rgba(69,85,105,0.08)' : 'none' }} onClick={() => toggle('summary')}>
            <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--sia-navy)', fontFamily: 'var(--font-display)' }}>Executive Summary</span>
            <div style={{ display: 'flex', gap: '8px' }}>
              {pillar.execSummary?.edited && !editingSummary && (
                <button className="btn btn-ghost btn-sm" data-testid="button-edit-summary" onClick={e => { e.stopPropagation(); setSummaryEdit(pillar.execSummary.edited); setEditingSummary(true); setExpandedSections((s: any) => ({...s, summary: true})) }}>
                  <Edit3 size={12} /> Edit
                </button>
              )}
              {expandedSections.summary ? <ChevronUp size={16} color="var(--sia-medium-gray)" /> : <ChevronDown size={16} color="var(--sia-medium-gray)" />}
            </div>
          </div>
          {expandedSections.summary && (
            <div style={{ padding: '20px' }}>
              {editingSummary ? (
                <div>
                  <textarea className="form-input" value={summaryEdit} onChange={e => setSummaryEdit(e.target.value)} style={{ minHeight: '160px', marginBottom: '12px', width: '100%' }} />
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button className="btn btn-primary btn-sm" data-testid="button-save-summary" onClick={saveSummary}><Save size={12} /> Save</button>
                    <button className="btn btn-ghost btn-sm" onClick={() => setEditingSummary(false)}><X size={12} /> Cancel</button>
                    <button className="btn btn-ghost btn-sm" onClick={() => setSummaryEdit(pillar.execSummary.aiDraft)}>Restore AI Draft</button>
                  </div>
                </div>
              ) : pillar.execSummary?.edited ? (
                <div>
                  {renderBullets(pillar.execSummary.edited, c => { setActiveSourceNum(c.num); setSourcesOpen(true) })}
                  {pillar.execSummary.useEdited && <div style={{ marginTop: '8px', fontSize: '11px', color: 'var(--sia-medium-gray)', fontStyle: 'italic' }}>✏️ Edited version</div>}
                </div>
              ) : (
                <div className="empty-state" style={{ padding: '30px 0' }}>
                  <p style={{ fontSize: '13px' }}>Run AI assessment to generate executive summary</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Assessment Elements */}
        <div className="card" style={{ marginBottom: '12px', overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', cursor: 'pointer', borderBottom: expandedSections.elements ? '1px solid rgba(69,85,105,0.08)' : 'none' }} onClick={() => toggle('elements')}>
            <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--sia-navy)', fontFamily: 'var(--font-display)' }}>Assessment Elements ({pillar.elements.length})</span>
            {expandedSections.elements ? <ChevronUp size={16} color="var(--sia-medium-gray)" /> : <ChevronDown size={16} color="var(--sia-medium-gray)" />}
          </div>
          {expandedSections.elements && (
            <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {pillar.elements.map((el: any, i: number) => {
                const elRag = getRag(el.aiScore)
                const diagQs = ELEMENT_QUESTIONS[el.name] || []
                const isQExpanded = expandedQuestions[el.id]
                return (
                  <div key={el.id} data-testid={`element-${el.id}`} style={{ background: 'var(--sia-light-gray)', borderRadius: 'var(--radius)', borderLeft: `3px solid ${PILLAR_COLORS[activePillar]}`, overflow: 'hidden' }}>
                    {/* Element Header */}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', background: 'white', borderBottom: '1px solid rgba(69,85,105,0.06)' }}>
                      <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--sia-navy)' }}>{el.name}</div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        {el.aiScore && <span className={`rag-badge rag-${elRag}`}>Score: {el.aiScore}/5</span>}
                        {project.interviewModeEnabled && (
                          <input key={`${activeEntityId || 'main'}-${el.id}`} type="number" min="1" max="5" step="0.5" placeholder="I" defaultValue={el.manualScore || ''}
                            onBlur={e => { if (e.target.value) saveElementNote(i, 'manualScore', parseFloat(e.target.value)) }}
                            style={{ width: '44px', padding: '3px 6px', border: '1px solid rgba(69,85,105,0.2)', borderRadius: '4px', fontSize: '12px', textAlign: 'center', background: 'white' }} />
                        )}
                      </div>
                    </div>

                    {/* Diagnostic Questions (collapsible) */}
                    {diagQs.length > 0 && (
                      <div style={{ borderBottom: '1px solid rgba(69,85,105,0.06)' }}>
                        <button onClick={() => toggleQuestion(el.id)} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 16px', background: 'rgba(0,222,204,0.04)', border: 'none', cursor: 'pointer', textAlign: 'left' }}>
                          <span style={{ fontSize: '11px', color: 'var(--sia-teal)', fontWeight: 600 }}>📋 Diagnostic Questions</span>
                          {isQExpanded ? <ChevronUp size={12} color="var(--sia-teal)" /> : <ChevronDown size={12} color="var(--sia-teal)" />}
                        </button>
                        {isQExpanded && (
                          <div style={{ padding: '8px 16px 12px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                            {diagQs.map((q, qi) => (
                              <div key={qi} style={{ display: 'flex', gap: '8px', fontSize: '11px', color: 'var(--sia-cool-gray)' }}>
                                <span style={{ color: 'var(--sia-teal)', fontWeight: 700, flexShrink: 0 }}>{qi+1}.</span>
                                <span>{q}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                      {/* Consultant Notes */}
                      <div>
                        <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--sia-medium-gray)', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>📝 Consultant Notes</div>
                        <textarea key={`${activeEntityId || 'main'}-${el.id}-notes`} placeholder="Add your notes, observations, or interview findings here..." defaultValue={el.notes || ''} onBlur={e => { if (e.target.value !== el.notes) saveElementNote(i, 'notes', e.target.value) }}
                          style={{ width: '100%', padding: '8px 10px', border: '1px solid rgba(69,85,105,0.15)', borderRadius: '4px', fontSize: '12px', resize: 'vertical', minHeight: '48px', background: 'white', fontFamily: 'var(--font-body)', color: 'var(--sia-cool-gray)', lineHeight: 1.5 }} rows={2}
                        />
                      </div>

                      {/* Generated Analysis */}
                      {el.aiAnswer && (() => {
                        const lines = el.aiAnswer.split('\n').filter(Boolean)
                        return (
                          <div>
                            <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--sia-medium-gray)', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>🤖 Generated Analysis</div>
                            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '4px' }}>
                              {(lines as string[]).map((line: string, li: number) => (
                                <li key={li} style={{ display: 'flex', gap: '8px', alignItems: 'flex-start', fontSize: '13px', color: 'var(--sia-cool-gray)', lineHeight: 1.55 }}>
                                  <span style={{ color: 'var(--sia-teal)', flexShrink: 0, fontWeight: 700, marginTop: '1px' }}>•</span>
                                  <CitedText text={line.replace(/^•\s*/, '')} onCiteClick={c => { setActiveSourceNum(c.num); setSourcesOpen(true) }} />
                                </li>
                              ))}
                            </ul>
                          </div>
                        )
                      })()}

                      {/* Score Rationale */}
                      {el.scoreRationale && (
                        <div style={{ padding: '8px 12px', background: 'white', borderRadius: '4px', border: '1px solid rgba(69,85,105,0.1)', fontSize: '12px', color: 'var(--sia-cool-gray)', lineHeight: 1.5 }}>
                          <div style={{ fontSize: '10px', fontWeight: 600, color: 'var(--sia-navy)', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>📊 Score Rationale</div>
                          <CitedText text={el.scoreRationale} onCiteClick={c => { setActiveSourceNum(c.num); setSourcesOpen(true) }} />
                        </div>
                      )}

                      {/* Evidence Quote */}
                      {el.evidenceQuote && el.evidenceQuote !== 'Not found in documents' && el.evidenceQuote !== 'No direct evidence found' && (() => {
                        const evText = el.evidenceQuote.substring(0, 240) + (el.evidenceQuote.length > 240 ? '...' : '')
                        return (
                          <div style={{ padding: '8px 12px', background: 'white', borderRadius: '4px', borderLeft: '2px solid var(--sia-teal)', fontSize: '12px', color: 'var(--sia-cool-gray)', fontStyle: 'italic', lineHeight: 1.5 }}>
                            <div style={{ fontSize: '10px', fontWeight: 600, color: 'var(--sia-teal)', marginBottom: '4px', fontStyle: 'normal', textTransform: 'uppercase', letterSpacing: '0.5px' }}>💬 Evidence</div>
                            "<CitedText text={evText} onCiteClick={c => { setActiveSourceNum(c.num); setSourcesOpen(true) }} />" <span style={{ fontStyle: 'normal', color: 'var(--sia-medium-gray)' }}>— {el.sourceDocument}</span>
                          </div>
                        )
                      })()}

                      {/* Data Gap */}
                      {el.dataGap && (
                        <div style={{ display: 'flex', gap: '6px', alignItems: 'flex-start', padding: '6px 10px', background: '#FFFBEB', borderRadius: '4px', border: '1px solid #FDE68A' }}>
                          <AlertCircle size={12} color="var(--sia-amber)" style={{ marginTop: '1px', flexShrink: 0 }} />
                          <span style={{ fontSize: '11px', color: '#92400E' }}>Data gap: {el.dataGap}</span>
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* SWOT */}
        <div className="card" style={{ marginBottom: '12px', overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', cursor: 'pointer', borderBottom: expandedSections.swot ? '1px solid rgba(69,85,105,0.08)' : 'none' }} onClick={() => toggle('swot')}>
            <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--sia-navy)', fontFamily: 'var(--font-display)' }}>Pillar SWOT Analysis</span>
            {expandedSections.swot ? <ChevronUp size={16} color="var(--sia-medium-gray)" /> : <ChevronDown size={16} color="var(--sia-medium-gray)" />}
          </div>
          {expandedSections.swot && (
            <div style={{ padding: '16px 20px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              {swotConfig.map(sq => (
                <div key={sq.key} className={sq.cls} style={{ padding: '14px', borderRadius: 'var(--radius)', border: '1px solid' }}>
                  <div style={{ fontSize: '12px', fontWeight: 700, color: sq.color, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '8px' }}>{sq.label}</div>
                  {((pillar.swot as any)?.[sq.key] || []).length > 0 ? (
                    <ul style={{ paddingLeft: '16px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      {((pillar.swot as any)[sq.key] || []).map((item: string, i: number) => (
                        <li key={i} style={{ fontSize: '12px', color: sq.color, lineHeight: 1.5 }}><CitedText text={item} onCiteClick={c => { setActiveSourceNum(c.num); setSourcesOpen(true) }} /></li>
                      ))}
                    </ul>
                  ) : (
                    <div style={{ fontSize: '12px', color: sq.color, opacity: 0.5 }}>Run assessment to populate</div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Interview Questions — Tabbed */}
        {hasAnyIQ && (
          <div className="card" style={{ marginBottom: '12px', overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', cursor: 'pointer', borderBottom: expandedSections.questions ? '1px solid rgba(69,85,105,0.08)' : 'none' }} onClick={() => toggle('questions')}>
              <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--sia-navy)', fontFamily: 'var(--font-display)' }}>Stakeholder Interview Questions</span>
              {expandedSections.questions ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </div>
            {expandedSections.questions && (
              <div>
                {isNewIQFormat ? (
                  <>
                    <div style={{ display: 'flex', borderBottom: '1px solid rgba(69,85,105,0.08)', padding: '0 20px' }}>
                      {[
                        { key: 'leadership', label: '👔 Leadership', count: iqData.leadership?.length || 0 },
                        { key: 'team', label: '🏢 Team Leads', count: iqData.team?.length || 0 },
                        { key: 'gapFilling', label: '🔍 Gap-Filling', count: iqData.gapFilling?.length || 0 },
                      ].map(tab => (
                        <button key={tab.key} onClick={() => setInterviewTab(tab.key as any)}
                          style={{ padding: '10px 16px', borderTop: 'none', borderRight: 'none', borderLeft: 'none', borderBottom: `2px solid ${interviewTab === tab.key ? 'var(--sia-teal)' : 'transparent'}`, background: 'transparent', cursor: 'pointer', fontSize: '12px', fontWeight: interviewTab === tab.key ? 700 : 400, color: interviewTab === tab.key ? 'var(--sia-navy)' : 'var(--sia-cool-gray)', transition: 'all 0.15s', display: 'flex', gap: '6px', alignItems: 'center' }}>
                          {tab.label}
                          <span style={{ fontSize: '10px', padding: '1px 5px', borderRadius: '8px', background: interviewTab === tab.key ? 'var(--sia-teal)' : 'var(--sia-light-gray)', color: interviewTab === tab.key ? 'var(--sia-navy)' : 'var(--sia-cool-gray)', fontWeight: 600 }}>{tab.count}</span>
                        </button>
                      ))}
                    </div>
                    <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      {interviewTab === 'leadership' && (iqData.leadership || []).map((q: string, i: number) => (
                        <div key={i} style={{ display: 'flex', gap: '10px', padding: '10px 14px', background: 'var(--sia-light-gray)', borderRadius: 'var(--radius)' }}>
                          <span style={{ fontFamily: 'var(--font-display)', fontSize: '13px', fontWeight: 700, color: 'var(--sia-teal)', flexShrink: 0 }}>{i+1}.</span>
                          <span style={{ fontSize: '13px', color: 'var(--sia-cool-gray)', lineHeight: 1.5 }}><CitedText text={q} onCiteClick={c => { setActiveSourceNum(c.num); setSourcesOpen(true) }} /></span>
                        </div>
                      ))}
                      {interviewTab === 'team' && (iqData.team || []).map((q: string, i: number) => (
                        <div key={i} style={{ display: 'flex', gap: '10px', padding: '10px 14px', background: 'var(--sia-light-gray)', borderRadius: 'var(--radius)' }}>
                          <span style={{ fontFamily: 'var(--font-display)', fontSize: '13px', fontWeight: 700, color: '#3B82F6', flexShrink: 0 }}>{i+1}.</span>
                          <span style={{ fontSize: '13px', color: 'var(--sia-cool-gray)', lineHeight: 1.5 }}><CitedText text={q} onCiteClick={c => { setActiveSourceNum(c.num); setSourcesOpen(true) }} /></span>
                        </div>
                      ))}
                      {interviewTab === 'gapFilling' && (iqData.gapFilling || []).map((item: any, i: number) => (
                        <div key={i} style={{ padding: '10px 14px', background: '#FFFBEB', borderRadius: 'var(--radius)', border: '1px solid #FDE68A' }}>
                          <div style={{ fontSize: '10px', fontWeight: 700, color: '#92400E', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '4px' }}>
                            Gap: {item.element} — {item.gap}
                          </div>
                          <div style={{ fontSize: '13px', color: 'var(--sia-cool-gray)', lineHeight: 1.5 }}><CitedText text={item.question} onCiteClick={c => { setActiveSourceNum(c.num); setSourcesOpen(true) }} /></div>
                        </div>
                      ))}
                      {((interviewTab === 'leadership' && !iqData.leadership?.length) ||
                        (interviewTab === 'team' && !iqData.team?.length) ||
                        (interviewTab === 'gapFilling' && !iqData.gapFilling?.length)) && (
                        <div style={{ textAlign: 'center', padding: '20px', color: 'var(--sia-medium-gray)', fontSize: '13px' }}>No questions in this category</div>
                      )}
                    </div>
                  </>
                ) : (
                  <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {(iqData as string[]).map((q: string, i: number) => (
                      <div key={i} style={{ display: 'flex', gap: '10px', padding: '10px 14px', background: 'var(--sia-light-gray)', borderRadius: 'var(--radius)' }}>
                        <span style={{ fontFamily: 'var(--font-display)', fontSize: '14px', fontWeight: 700, color: 'var(--sia-teal)', flexShrink: 0 }}>{i+1}.</span>
                        <span style={{ fontSize: '13px', color: 'var(--sia-cool-gray)', lineHeight: 1.5 }}><CitedText text={q} onCiteClick={c => { setActiveSourceNum(c.num); setSourcesOpen(true) }} /></span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Benchmark Section */}
        <div className="card" style={{ marginBottom: '12px', overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', cursor: 'pointer', borderBottom: expandedSections.benchmarks && benchmarkData ? '1px solid rgba(69,85,105,0.08)' : 'none' }} onClick={() => toggle('benchmarks')}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <BarChart2 size={15} color="var(--sia-teal)" />
              <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--sia-navy)', fontFamily: 'var(--font-display)' }}>Benchmark & Peer Comparison</span>
              {benchmarkData && <span style={{ fontSize: '11px', padding: '2px 8px', background: 'rgba(0,222,204,0.1)', color: 'var(--sia-teal)', borderRadius: '10px', fontWeight: 600 }}>Loaded</span>}
            </div>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              {!benchmarkData || !pillar.finalScore ? (
                <button className="btn btn-ghost btn-sm" data-testid="button-load-benchmarks" onClick={e => { e.stopPropagation(); loadBenchmarks() }} disabled={loadingBenchmarks}>
                  {loadingBenchmarks ? <><Loader2 size={12} className="spinner" /> Loading...</> : <><RefreshCw size={12} /> Load Benchmarks</>}
                </button>
              ) : (
                <button className="btn btn-ghost btn-sm" onClick={e => { e.stopPropagation(); loadBenchmarks() }} disabled={loadingBenchmarks}>
                  {loadingBenchmarks ? <><Loader2 size={12} className="spinner" /></> : <><RefreshCw size={12} /></>}
                </button>
              )}
              {expandedSections.benchmarks ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </div>
          </div>
          {expandedSections.benchmarks && (
            <div style={{ padding: '16px 20px' }}>
              {!benchmarkData ? (
                <div className="empty-state" style={{ padding: '24px 0' }}>
                  <BarChart2 size={28} color="var(--sia-medium-gray)" style={{ margin: '0 auto 12px' }} />
                  <p style={{ fontSize: '13px' }}>Click "Load Benchmarks" to compare this pillar against GCC peers and global best practice</p>
                </div>
              ) : (
                <>
                  <div style={{ overflowX: 'auto', marginBottom: '16px' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                      <thead>
                        <tr style={{ borderBottom: '2px solid rgba(69,85,105,0.1)' }}>
                          <th style={{ textAlign: 'left', padding: '8px 12px', color: 'var(--sia-medium-gray)', fontWeight: 600, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Organization</th>
                          <th style={{ textAlign: 'left', padding: '8px 12px', color: 'var(--sia-medium-gray)', fontWeight: 600, fontSize: '11px', textTransform: 'uppercase' }}>Country</th>
                          <th style={{ textAlign: 'center', padding: '8px 12px', color: 'var(--sia-medium-gray)', fontWeight: 600, fontSize: '11px', textTransform: 'uppercase' }}>Score</th>
                          <th style={{ textAlign: 'center', padding: '8px 12px', color: 'var(--sia-medium-gray)', fontWeight: 600, fontSize: '11px', textTransform: 'uppercase' }}>vs Entity</th>
                          <th style={{ textAlign: 'left', padding: '8px 12px', color: 'var(--sia-medium-gray)', fontWeight: 600, fontSize: '11px', textTransform: 'uppercase' }}>Notes</th>
                        </tr>
                      </thead>
                      <tbody>
                        {/* Entity row */}
                        <tr style={{ background: 'rgba(0,222,204,0.06)', borderBottom: '1px solid rgba(69,85,105,0.06)' }}>
                          <td style={{ padding: '10px 12px', fontWeight: 700, color: 'var(--sia-navy)' }}>{project.entityName}</td>
                          <td style={{ padding: '10px 12px', color: 'var(--sia-cool-gray)' }}>🏢 Current</td>
                          <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                            <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '14px', color: RAG_COLORS[getRag(benchmarkData.entityScore)] }}>{(benchmarkData.entityScore || 0).toFixed(1)}</span>
                          </td>
                          <td style={{ padding: '10px 12px', textAlign: 'center', color: 'var(--sia-medium-gray)' }}>—</td>
                          <td style={{ padding: '10px 12px', color: 'var(--sia-cool-gray)', fontStyle: 'italic' }}>Entity under assessment</td>
                        </tr>
                        {(benchmarkData.benchmarks || []).map((b: any, i: number) => {
                          const diff = (b.score - (benchmarkData.entityScore || 0)).toFixed(1)
                          const diffNum = parseFloat(diff)
                          const bRag = getRag(b.score)
                          return (
                            <tr key={i} style={{ borderBottom: '1px solid rgba(69,85,105,0.05)', background: i % 2 === 0 ? 'transparent' : 'var(--sia-light-gray)' }}>
                              <td style={{ padding: '9px 12px', fontWeight: 500, color: 'var(--sia-navy)' }}>{b.organization}</td>
                              <td style={{ padding: '9px 12px', color: 'var(--sia-cool-gray)' }}>{b.flag} {b.country}</td>
                              <td style={{ padding: '9px 12px', textAlign: 'center' }}>
                                <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, color: RAG_COLORS[bRag] }}>{b.score.toFixed(1)}</span>
                              </td>
                              <td style={{ padding: '9px 12px', textAlign: 'center' }}>
                                <span style={{ fontSize: '11px', fontWeight: 700, color: diffNum > 0 ? '#991B1B' : diffNum < 0 ? '#10B981' : 'var(--sia-medium-gray)' }}>
                                  {diffNum > 0 ? `+${diff}` : diff}
                                </span>
                              </td>
                              <td style={{ padding: '9px 12px', fontSize: '11px', color: 'var(--sia-cool-gray)' }}>{b.notes}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                  {benchmarkData.keyInsights?.length > 0 && (
                    <div style={{ padding: '12px 14px', background: 'rgba(0,222,204,0.05)', borderRadius: '6px', marginBottom: '10px' }}>
                      <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--sia-teal)', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Key Insights</div>
                      {benchmarkData.keyInsights.map((ins: string, i: number) => (
                        <div key={i} style={{ display: 'flex', gap: '6px', marginBottom: '4px', fontSize: '12px', color: 'var(--sia-cool-gray)' }}>
                          <span style={{ color: 'var(--sia-teal)', flexShrink: 0 }}>•</span>
                          <span>{ins}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        {/* AI Consultant Chat */}
        <div className="card" style={{ marginBottom: '12px', overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', cursor: 'pointer', borderBottom: expandedSections.chat ? '1px solid rgba(69,85,105,0.08)' : 'none' }} onClick={() => toggle('chat')}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <MessageSquare size={15} color="var(--sia-teal)" />
              <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--sia-navy)', fontFamily: 'var(--font-display)' }}>AI Consultant Chat</span>
              {chatMessages.length > 0 && <span style={{ fontSize: '10px', padding: '2px 6px', background: 'rgba(0,222,204,0.1)', color: 'var(--sia-teal)', borderRadius: '8px', fontWeight: 600 }}>{chatMessages.filter((m: any) => m.role === 'user').length} messages</span>}
            </div>
            {expandedSections.chat ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </div>
          {expandedSections.chat && (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {chatMessages.length === 0 && (
                <div style={{ padding: '16px 20px 0', borderBottom: '1px solid rgba(69,85,105,0.06)' }}>
                  <div style={{ fontSize: '11px', color: 'var(--sia-medium-gray)', marginBottom: '8px', fontWeight: 500 }}>Suggested prompts — click to use:</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', paddingBottom: '12px' }}>
                    {STARTER_PROMPTS.map(q => (
                      <button key={q} onClick={() => setChatInput(q)} data-testid={`chip-${q.slice(0,20).replace(/\s/g,'-')}`}
                        style={{ padding: '6px 12px', background: 'var(--sia-light-gray)', border: '1px solid rgba(69,85,105,0.12)', borderRadius: '16px', fontSize: '11px', color: 'var(--sia-cool-gray)', cursor: 'pointer', whiteSpace: 'nowrap', transition: 'all 0.15s' }}
                        onMouseEnter={e => { (e.target as HTMLElement).style.background = 'rgba(0,222,204,0.08)'; (e.target as HTMLElement).style.borderColor = 'var(--sia-teal)'; (e.target as HTMLElement).style.color = 'var(--sia-navy)' }}
                        onMouseLeave={e => { (e.target as HTMLElement).style.background = 'var(--sia-light-gray)'; (e.target as HTMLElement).style.borderColor = 'rgba(69,85,105,0.12)'; (e.target as HTMLElement).style.color = 'var(--sia-cool-gray)' }}>
                        {q}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div style={{ minHeight: '180px', maxHeight: '320px', overflow: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {chatMessages.length === 0 ? (
                  <div style={{ textAlign: 'center', color: 'var(--sia-medium-gray)', fontSize: '13px', marginTop: '20px' }}>Ask anything about this pillar's assessment...</div>
                ) : (
                  chatMessages.map((msg: any, i: number) => (
                    <div key={i} style={{ display: 'flex', gap: '10px', flexDirection: msg.role === 'user' ? 'row-reverse' : 'row' }}>
                      <div style={{ width: '28px', height: '28px', borderRadius: '50%', background: msg.role === 'user' ? 'var(--sia-light-gray)' : 'var(--sia-navy)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', fontWeight: 700, color: msg.role === 'user' ? 'var(--sia-cool-gray)' : 'var(--sia-teal)', flexShrink: 0, fontFamily: 'var(--font-display)' }}>
                        {msg.role === 'user' ? 'You' : 'SIA'}
                      </div>
                      {msg.role === 'user' ? (
                        <div style={{ maxWidth: '80%', padding: '10px 14px', background: 'var(--sia-light-gray)', borderRadius: '10px', fontSize: '13px', color: 'var(--sia-cool-gray)', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
                          {msg.content}
                        </div>
                      ) : (
                        <div style={{ maxWidth: '85%', padding: '12px 16px', background: 'rgba(0,222,204,0.06)', border: '1px solid rgba(0,222,204,0.18)', borderRadius: '10px' }}>
                          <div className="chat-response-body">
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                          </div>
                          {msg.streaming && <span className="streaming" />}
                        </div>
                      )}
                    </div>
                  ))
                )}
                <div ref={chatEndRef} />
              </div>
              {chatMessages.length > 0 && (
                <div style={{ padding: '8px 16px', borderTop: '1px solid rgba(69,85,105,0.06)', display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                  {STARTER_PROMPTS.map(q => (
                    <button key={q} onClick={() => setChatInput(q)}
                      style={{ padding: '4px 10px', background: 'var(--sia-light-gray)', border: '1px solid rgba(69,85,105,0.1)', borderRadius: '12px', fontSize: '10px', color: 'var(--sia-cool-gray)', cursor: 'pointer' }}>
                      {q}
                    </button>
                  ))}
                </div>
              )}
              <div style={{ padding: '12px 16px', borderTop: '1px solid rgba(69,85,105,0.08)', display: 'flex', gap: '8px' }}>
                <input type="text" value={chatInput} onChange={e => setChatInput(e.target.value)} data-testid="chat-input"
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat() } }}
                  placeholder="Ask about this pillar..."
                  style={{ flex: 1, padding: '10px 14px', border: '1.5px solid rgba(69,85,105,0.2)', borderRadius: 'var(--radius)', fontFamily: 'var(--font-body)', fontSize: '14px', outline: 'none' }}
                />
                <button className="btn btn-primary" data-testid="button-send-chat" onClick={sendChat} disabled={chatStreaming || !chatInput.trim()} style={{ padding: '10px 16px' }}>
                  {chatStreaming ? <Loader2 size={14} className="spinner" /> : <Send size={14} />}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Resources & References */}
        <div className="card" style={{ marginBottom: '32px', overflow: 'hidden' }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid rgba(69,85,105,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <BookOpen size={15} color="var(--sia-teal)" />
              <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--sia-navy)', fontFamily: 'var(--font-display)' }}>Source Documents Uploaded</span>
            </div>
            <span style={{ fontSize: '11px', color: 'var(--sia-medium-gray)' }}>{effectiveDocuments.length || 0} document{effectiveDocuments.length !== 1 ? 's' : ''}</span>
          </div>
          <div style={{ padding: '12px 20px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {effectiveDocuments.length === 0 ? (
              <div style={{ fontSize: '12px', color: 'var(--sia-medium-gray)', padding: '8px 0' }}>No documents uploaded{activeEntity ? ` for ${activeEntity.name}` : ''}. {!activeEntity && <a href="/app/setup" style={{ color: 'var(--sia-teal)' }}>Upload in Project Setup →</a>}</div>
            ) : effectiveDocuments.map((doc: any, i: number) => {
              const hasText = doc.extractedText && doc.extractedText.length >= 100
              return (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 12px', background: hasText ? 'rgba(16,185,129,0.04)' : '#FFF7ED', borderRadius: '6px', border: `1px solid ${hasText ? 'rgba(16,185,129,0.15)' : '#FDBA74'}` }}>
                  <span style={{ fontSize: '14px', flexShrink: 0 }}>{doc.name?.endsWith('.pdf') ? '📄' : doc.name?.endsWith('.xlsx') ? '📊' : '📝'}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--sia-navy)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{doc.name}</div>
                    <div style={{ fontSize: '11px', color: 'var(--sia-medium-gray)' }}>{doc.wordCount ? `${doc.wordCount.toLocaleString()} words extracted` : hasText ? 'Text extracted' : 'Limited text extracted'}</div>
                  </div>
                  {hasText ? <CheckCircle size={12} color="#10B981" /> : <AlertCircle size={12} color="#EA580C" />}
                </div>
              )
            })}
          </div>

          {/* Dynamic AI References from assessment */}
          {pillar.references && pillar.references.length > 0 && (
            <>
              <div style={{ padding: '12px 20px 8px', borderTop: '1px solid rgba(69,85,105,0.08)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <ExternalLink size={13} color="var(--sia-teal)" />
                <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--sia-navy)' }}>Official References</span>
                <span style={{ fontSize: '10px', color: 'var(--sia-medium-gray)', marginLeft: '4px' }}>AI-sourced from official & academic sources only</span>
              </div>
              <div style={{ padding: '0 20px 16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {pillar.references.map((ref: any, i: number) => (
                  <div key={i} style={{ padding: '10px 14px', background: 'rgba(0,222,204,0.04)', border: '1px solid rgba(0,222,204,0.15)', borderRadius: '8px' }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '3px', flexWrap: 'wrap' }}>
                          <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--sia-navy)', lineHeight: 1.3 }}>{ref.title}</span>
                          <span style={{ fontSize: '9px', fontWeight: 700, padding: '1px 6px', borderRadius: '4px', background: 'rgba(0,222,204,0.15)', color: 'var(--sia-teal)', textTransform: 'uppercase', whiteSpace: 'nowrap', flexShrink: 0 }}>{ref.type}</span>
                        </div>
                        <div style={{ fontSize: '11px', color: 'var(--sia-cool-gray)', marginBottom: '4px' }}>
                          {ref.publishedBy}{ref.year ? ` · ${ref.year}` : ''}
                        </div>
                        {ref.relevance && <div style={{ fontSize: '11px', color: 'var(--sia-medium-gray)', lineHeight: 1.4, fontStyle: 'italic' }}>{ref.relevance}</div>}
                      </div>
                      {ref.url && ref.url !== 'N/A' && ref.url !== '' && (
                        <a href={ref.url} target="_blank" rel="noopener noreferrer" style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: '3px', fontSize: '11px', color: 'var(--sia-teal)', fontWeight: 600, textDecoration: 'none', padding: '4px 8px', background: 'rgba(0,222,204,0.1)', borderRadius: '4px', marginTop: '1px' }}>
                          <ExternalLink size={10} /> View
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
