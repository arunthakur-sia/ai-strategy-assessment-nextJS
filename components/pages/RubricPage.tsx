'use client'
import { BookOpen, Pencil, Check, X, RotateCcw, AlertCircle } from 'lucide-react'
import { useState } from 'react'
import { useStore } from '@/store/useStore'
import EntityBanner from '@/components/EntityBanner'
import { projectsApi } from '@/lib/api'

const BANDS = [
  { key: 'critical',   range: '1.0 – 2.0', label: 'Critical',   bg: '#FEF2F2', color: '#991B1B' },
  { key: 'weak',       range: '2.0 – 3.0', label: 'Weak',       bg: '#FFF7ED', color: '#92400E' },
  { key: 'developing', range: '3.0 – 3.5', label: 'Developing', bg: '#FFFBEB', color: '#78350F' },
  { key: 'strong',     range: '3.5 – 4.5', label: 'Strong',     bg: '#EFF6FF', color: '#1E40AF' },
  { key: 'excellent',  range: '4.5 – 5.0', label: 'Excellent',  bg: '#ECFDF5', color: '#065F46' },
]

const PILLARS = [
  {
    id: 'P1', name: 'Strategic Identity & Vision', color: '#00DECC',
    elements: [
      {
        name: 'Mission & Vision Clarity',
        critical:    'No mission/vision exists or is purely ceremonial with no strategic direction',
        weak:        'Mission exists but is generic, not differentiated or actively referenced by leadership',
        developing:  'Clear mission exists, referenced occasionally but not embedded in decision-making',
        strong:      'Compelling, differentiated mission actively used to guide strategy and resource allocation',
        excellent:   'Mission is a living strategic compass, consistently referenced, externally recognized, drives all decisions',
      },
      {
        name: 'Strategic Intent',
        critical:    'No defined strategic ambition or 3-5 year goals exist',
        weak:        'Goals exist but are vague, not time-bound, or internally contradictory',
        developing:  'Strategic intent is documented but lacks SMART criteria or clear accountability',
        strong:      'Clear SMART ambition with defined milestones, owned by leadership, regularly reviewed',
        excellent:   'Bold, inspiring, fully measurable ambition that motivates stakeholders and guides all strategic choices',
      },
      {
        name: 'Value Proposition',
        critical:    'No articulated value proposition; unclear what unique value the entity delivers',
        weak:        'Value proposition exists but is generic and indistinguishable from peers',
        developing:  'Value proposition is defined but inconsistently communicated across stakeholders',
        strong:      'Clear, differentiated value proposition understood by all key stakeholders',
        excellent:   'Industry-recognized value proposition, regularly validated with stakeholders, drives competitive advantage',
      },
      {
        name: 'Strategic Coherence',
        critical:    'Significant contradictions between stated strategy and actual resource allocation or priorities',
        weak:        'Partial alignment; some strategic elements conflict or are siloed across departments',
        developing:  'General alignment but gaps exist between strategy documents and operational priorities',
        strong:      'Strong coherence across vision, strategy, and execution with regular alignment checks',
        excellent:   'Perfect strategic coherence; every initiative, budget, and decision traces back to the core strategy',
      },
      {
        name: 'Parenting Purpose',
        critical:    'No clear theory of how the holding creates value for subsidiaries',
        weak:        'Holding role is primarily financial with no strategic value-add to subsidiaries',
        developing:  'Some parenting value defined but inconsistently applied across the portfolio',
        strong:      'Clear parenting model (financial/strategic/operational) with measurable value-add per subsidiary',
        excellent:   'Best-in-class parenting model; holding is a recognized value multiplier across all subsidiaries',
      },
    ],
  },
  {
    id: 'P2', name: 'Governance & Leadership', color: '#077C84',
    elements: [
      {
        name: 'Board Composition & Effectiveness',
        critical:    'Board lacks required skills, independence, or meets irregularly with no clear mandate',
        weak:        'Board exists but dominated by insiders; limited independence or relevant expertise',
        developing:  'Board has basic structure but committees are inactive or lack authority',
        strong:      'Diverse, independent board with active committees and clear terms of reference',
        excellent:   'Board recognized for governance excellence; proactive, diverse, fully independent with measurable impact',
      },
      {
        name: 'Leadership Team Capability',
        critical:    'Critical leadership roles vacant or filled by unqualified individuals',
        weak:        'Leadership team in place but significant skill gaps in key strategic areas',
        developing:  'Competent leadership with targeted gaps; succession planning is informal',
        strong:      'High-caliber leadership team with formal succession plans and development programs',
        excellent:   'World-class leadership team; recognized externally, with deep bench strength and active succession pipeline',
      },
      {
        name: 'Decision-Making Architecture',
        critical:    'Decisions are ad-hoc with no clear authority matrix or governance framework',
        weak:        'Some governance processes exist but frequently bypassed or unclear',
        developing:  'Delegation of authority exists but is inconsistently applied across departments',
        strong:      'Clear decision rights framework, consistently applied, with appropriate escalation paths',
        excellent:   'Optimized decision architecture enabling speed and accountability at all levels',
      },
      {
        name: 'Accountability & Performance Management',
        critical:    'No performance management system; leaders not held accountable for outcomes',
        weak:        'KPIs exist but are not cascaded or consistently measured',
        developing:  'Performance framework in place but incentives weakly linked to strategic outcomes',
        strong:      'Robust performance management with KPI cascading, regular reviews, and consequence management',
        excellent:   'Performance culture fully embedded; transparent metrics, real-time tracking, and merit-based accountability',
      },
      {
        name: 'Parenting Style',
        critical:    'No defined parenting model; the holding exercises no discernible governance role',
        weak:        'Holding acts purely as a passive financial owner; no strategic or operational support is extended',
        developing:  'Parenting style is partially defined (e.g., financial holding with selective strategic input) but inconsistently applied across the portfolio',
        strong:      'Clear parenting model is defined, documented, and consistently applied across subsidiaries with measurable value-add',
        excellent:   'Best-in-class parenting model; precisely calibrated per subsidiary, dynamically adjusted, recognized as primary value driver',
      },
    ],
  },
  {
    id: 'P3', name: 'Financial Health & Performance', color: '#10B981',
    elements: [
      {
        name: 'Revenue Trajectory',
        critical:    'Declining revenues with no credible recovery plan or diversification strategy',
        weak:        'Flat or marginal growth below sector benchmarks; high revenue concentration risk',
        developing:  'Moderate growth in line with market but limited diversification of revenue streams',
        strong:      'Consistent above-market revenue growth with diversified and resilient revenue mix',
        excellent:   'Exceptional revenue growth with fully diversified streams and strong forward visibility',
      },
      {
        name: 'Profitability Analysis',
        critical:    'Operating at a loss with no clear path to profitability',
        weak:        'Thin or volatile margins significantly below sector peers',
        developing:  'Adequate margins but cost structure optimization opportunities remain significant',
        strong:      'Healthy margins above sector average with consistent improvement trend',
        excellent:   'Best-in-class margins through optimized cost structure and high-value revenue mix',
      },
      {
        name: 'Liquidity & Solvency',
        critical:    'Immediate liquidity concerns; unable to meet near-term obligations',
        weak:        'Adequate current liquidity but concerning medium-term solvency indicators',
        developing:  'Sufficient liquidity with manageable debt levels; limited financial flexibility',
        strong:      'Strong liquidity position with comfortable debt ratios and access to capital',
        excellent:   'Exceptional financial strength; significant reserves, minimal debt, and multiple capital access options',
      },
      {
        name: 'Cash Flow Quality',
        critical:    'Negative operating cash flow; reliant on external financing for operations',
        weak:        'Positive but volatile cash flow with high capex intensity limiting free cash',
        developing:  'Consistent operating cash flow but working capital management needs improvement',
        strong:      'Strong, predictable operating cash flow with disciplined capital allocation',
        excellent:   'Exceptional cash generation with optimized working capital and high free cash flow conversion',
      },
      {
        name: 'Capital Allocation Efficiency',
        critical:    'No disciplined capital allocation framework; investments made without ROI assessment',
        weak:        'Basic investment criteria exist but returns consistently below cost of capital',
        developing:  'Capital allocation process in place but not fully linked to strategic priorities',
        strong:      'Disciplined capital allocation with returns consistently above cost of capital',
        excellent:   'World-class capital allocation; rigorous portfolio optimization with measurable value creation',
      },
    ],
  },
  {
    id: 'P4', name: 'Market Position & Competitive Landscape', color: '#3B82F6',
    elements: [
      {
        name: 'Market Size & Growth',
        critical:    'No understanding of addressable market size or growth trajectory',
        weak:        'Basic market data available but analysis is outdated or incomplete',
        developing:  'Market sizing conducted but TAM/SAM/SOM segmentation lacks rigor',
        strong:      'Comprehensive, current market intelligence with validated TAM/SAM/SOM analysis',
        excellent:   'Deep market intelligence capability; real-time monitoring with predictive market trend analysis',
      },
      {
        name: 'Market Share & Positioning',
        critical:    'Unknown or declining market share with no differentiated positioning',
        weak:        'Marginal market presence; positioning is unclear or easily replicated by competitors',
        developing:  'Established market presence but positioning is not strongly differentiated',
        strong:      'Clear market leadership in target segments with defensible positioning',
        excellent:   'Dominant market position with recognized brand equity and pricing power',
      },
      {
        name: 'Competitive Dynamics',
        critical:    'No competitive intelligence; unaware of key competitor moves or disruptive threats',
        weak:        'Basic competitor tracking exists but no systematic analysis or strategic response',
        developing:  'Competitive landscape mapped but monitoring is reactive rather than proactive',
        strong:      'Systematic competitive intelligence with proactive strategic responses to market changes',
        excellent:   'Sophisticated competitive intelligence function; anticipates shifts and shapes market dynamics',
      },
      {
        name: 'Customer Concentration & Satisfaction',
        critical:    'No customer satisfaction data; high dependency on a single customer or segment',
        weak:        'High customer concentration risk; satisfaction data collected but not acted upon',
        developing:  'Customer satisfaction tracked; some diversification but concentration risk remains',
        strong:      'Diversified customer base with high satisfaction scores and strong retention metrics',
        excellent:   'Loyal, diversified customer base with world-class NPS and proactive relationship management',
      },
      {
        name: 'Competitive Advantage',
        critical:    'No identifiable sustainable competitive advantage or differentiating capability',
        weak:        'Advantage exists but is temporary, easily imitated, or eroding',
        developing:  'Clear competitive advantage in specific areas but not consistently leveraged',
        strong:      'Well-defined, defensible competitive advantages across multiple dimensions',
        excellent:   'Multiple reinforcing competitive advantages creating a durable moat; continuously strengthened',
      },
    ],
  },
  {
    id: 'P5', name: 'Operational Excellence', color: '#8B5CF6',
    elements: [
      {
        name: 'Core Competencies',
        critical:    'Core capabilities are unclear or misaligned with strategic needs',
        weak:        'Some capabilities identified but not systematically developed or leveraged',
        developing:  'Core competencies defined but gaps exist relative to strategic requirements',
        strong:      'Well-defined core competencies aligned to strategy with active development programs',
        excellent:   'World-class capabilities in strategic areas; recognized externally, continuously refined',
      },
      {
        name: 'Operational Efficiency',
        critical:    'Significant operational inefficiencies; high cost base with no improvement roadmap',
        weak:        'Efficiency initiatives exist but are fragmented and not systematically measured',
        developing:  'Operational efficiency improving but still below sector benchmarks',
        strong:      'Operations consistently efficient; measurable productivity above sector average',
        excellent:   'Best-in-class operational efficiency; continuous improvement culture with lean practices embedded',
      },
      {
        name: 'Technology & Digital Maturity',
        critical:    'Legacy systems dominate; no digital strategy or transformation roadmap',
        weak:        'Digital initiatives underway but fragmented; technology investment below sector norms',
        developing:  'Digital transformation in progress with clear roadmap but execution gaps remain',
        strong:      'Modern technology stack; digital capabilities embedded in core operations',
        excellent:   'Digital-first organization; AI and advanced analytics drive competitive advantage',
      },
      {
        name: 'Supply Chain & Partnerships',
        critical:    'Supply chain is fragile; single-source dependencies and no contingency planning',
        weak:        'Partnerships exist but are transactional with limited strategic value creation',
        developing:  'Supply chain is adequate; strategic partnerships developing but not fully optimized',
        strong:      'Resilient supply chain with diversified partners and clear value-sharing frameworks',
        excellent:   'Ecosystem of strategic partnerships delivering measurable competitive advantage; fully resilient',
      },
      {
        name: 'Innovation Capability',
        critical:    'No formal innovation process; ideas not captured or developed',
        weak:        'Innovation efforts are ad-hoc with no governance, funding, or success metrics',
        developing:  'Innovation program exists but limited pipeline and inconsistent commercialization',
        strong:      'Structured innovation process with dedicated resources and measurable pipeline',
        excellent:   'Innovation is a core competency; consistent track record of breakthrough products/services',
      },
    ],
  },
  {
    id: 'P6', name: 'Organization & People', color: '#EC4899',
    elements: [
      {
        name: 'Organizational Structure',
        critical:    'Structure is misaligned to strategy; significant overlap, gaps, or fragmentation',
        weak:        'Structure partially aligned but creates inefficiencies and accountability gaps',
        developing:  'Organizational design is adequate but not optimized for strategic priorities',
        strong:      'Structure clearly aligned to strategy with defined roles and lean decision layers',
        excellent:   'Agile, future-ready organizational design; continuously adapted to strategic needs',
      },
      {
        name: 'Talent & Skills',
        critical:    'Critical skills gaps across the organization with no structured development plan',
        weak:        'Talent strategy exists but not linked to strategic workforce requirements',
        developing:  'Workforce planning in place; some skill gaps remain in key strategic areas',
        strong:      'Strong talent pipeline with skills closely matched to current and future needs',
        excellent:   'Talent is a strategic asset; top employer brand, exceptional retention, future-ready workforce',
      },
      {
        name: 'Culture & Values',
        critical:    'Culture is toxic, misaligned, or actively undermining strategic performance',
        weak:        'Values are defined but not lived; culture is inconsistent across teams',
        developing:  'Culture aligns with stated values but reinforcement mechanisms are limited',
        strong:      'Strong, positive culture actively reinforced by leaders and embedded in practices',
        excellent:   'Culture is a recognized competitive advantage; externally celebrated and consistently high-performing',
      },
      {
        name: 'Employee Engagement',
        critical:    'Very low engagement; high attrition, absenteeism, or visible disengagement',
        weak:        'Engagement measured but below sector average with no credible action plan',
        developing:  'Adequate engagement levels with targeted initiatives showing some improvement',
        strong:      'High engagement scores with robust listening mechanisms and action follow-through',
        excellent:   'Exceptional engagement; employees are brand ambassadors with best-in-class retention',
      },
      {
        name: 'Change Readiness',
        critical:    'Organization consistently resists change; past transformations have failed',
        weak:        'Change management capability is limited; initiatives face significant resistance',
        developing:  'Change readiness developing; structured change programs in place with mixed results',
        strong:      'Organization navigates change effectively with structured methodologies and high adoption',
        excellent:   'Change agility is a core strength; continuous adaptation with high success rate on transformations',
      },
    ],
  },
  {
    id: 'P7', name: 'Risk & Resilience', color: '#F59E0B',
    elements: [
      {
        name: 'Strategic Risk Management',
        critical:    'No strategic risk identification or mitigation; operating blindly to existential threats',
        weak:        'Risks identified informally but not quantified, owned, or actively managed',
        developing:  'Risk register exists but not integrated into strategic planning or decision-making',
        strong:      'Comprehensive strategic risk management with clear ownership and mitigation plans',
        excellent:   'Risk management is a strategic advantage; proactive horizon scanning with scenario planning embedded',
      },
      {
        name: 'Operational Risk Controls',
        critical:    'Major operational failures occur regularly; no documented controls or response plans',
        weak:        'Basic controls exist but inconsistently applied; incident response is reactive',
        developing:  'Controls documented and tested periodically; business continuity plans in development',
        strong:      'Robust operational controls with regular testing and clear incident response protocols',
        excellent:   'Operational resilience is a hallmark; zero critical failures, continuous monitoring, rapid recovery capability',
      },
      {
        name: 'Financial Risk Exposure',
        critical:    'Uncontrolled financial risks (FX, credit, liquidity) with no hedging strategy',
        weak:        'Financial risks identified but hedging is partial or not aligned to policy',
        developing:  'Risk limits defined and mostly adhered to; some exposures remain unmitigated',
        strong:      'Financial risks well-managed with appropriate hedging and within approved limits',
        excellent:   'Optimized financial risk management; minimal exposure with sophisticated risk instruments employed',
      },
      {
        name: 'Regulatory & Compliance',
        critical:    'Significant compliance failures or regulatory breaches; no compliance program',
        weak:        'Compliance function exists but is reactive; some regulatory gaps identified',
        developing:  'Compliance program in place with regular audits; minor gaps being addressed',
        strong:      'Full regulatory compliance with proactive monitoring and a strong audit trail',
        excellent:   'Compliance excellence; regulatory relationships are collaborative and the entity shapes standards',
      },
      {
        name: 'ESG & Sustainability',
        critical:    'No ESG strategy or reporting; significant reputational or regulatory exposure',
        weak:        'Basic ESG awareness but no targets, reporting framework, or accountability',
        developing:  'ESG strategy formulated with initial targets; reporting underway but gaps remain',
        strong:      'Comprehensive ESG strategy with measurable targets, verified reporting, and stakeholder disclosure',
        excellent:   'ESG leader; targets aligned to global standards, externally verified, with quantified impact delivered',
      },
    ],
  },
  {
    id: 'P8', name: 'Growth & Strategic Options', color: '#6366F1',
    elements: [
      {
        name: 'Organic Growth Vectors',
        critical:    'No identified organic growth opportunities; reliant entirely on existing business',
        weak:        'Growth levers identified but not resourced or actively pursued',
        developing:  'Organic growth initiatives underway with some traction but lacking scale',
        strong:      'Multiple funded organic growth vectors with clear milestones and accountability',
        excellent:   'Organic growth engine fully operational; consistently outpacing market with proven playbooks',
      },
      {
        name: 'Inorganic Growth (M&A)',
        critical:    'No M&A capability or strategy; past deals have destroyed value',
        weak:        'M&A considered opportunistically with no structured pipeline or integration capability',
        developing:  'M&A strategy defined with initial pipeline; integration capability being developed',
        strong:      'Active M&A pipeline with disciplined screening, due diligence, and integration track record',
        excellent:   'M&A is a core strategic capability; consistent value-creating deal flow with best-in-class integration',
      },
      {
        name: 'Digital & AI Opportunities',
        critical:    'No awareness or plans to leverage digital/AI for growth or efficiency',
        weak:        'Digital opportunities identified but no budget or roadmap committed',
        developing:  'Digital growth initiatives launched; AI use cases in pilot stage',
        strong:      'AI and digital initiatives delivering measurable growth and efficiency gains',
        excellent:   'AI-powered business model; digital capabilities are a primary source of competitive differentiation',
      },
      {
        name: 'Blue Ocean Opportunities',
        critical:    'Entirely focused on existing markets; no exploration of uncontested spaces',
        weak:        'Adjacent market opportunities discussed but not rigorously evaluated',
        developing:  'Blue ocean analysis conducted; some initiatives exploring new value frontiers',
        strong:      'Structured process to identify and test uncontested market opportunities',
        excellent:   'Proven ability to create new market spaces; multiple successful blue ocean moves executed',
      },
      {
        name: 'Portfolio Optimization',
        critical:    'No portfolio review process; underperforming entities retain capital indefinitely',
        weak:        'Portfolio reviewed informally; divestiture decisions lack rigor or are avoided',
        developing:  'Portfolio assessment conducted periodically; some optimization actions taken',
        strong:      'Active portfolio management with clear investment thesis per entity and regular rebalancing',
        excellent:   'Dynamic portfolio management; continuous optimization delivering superior returns across the portfolio',
      },
    ],
  },
]

function getBand(score: number) {
  if (score >= 4.5) return BANDS[4]
  if (score >= 3.5) return BANDS[3]
  if (score >= 3.0) return BANDS[2]
  if (score >= 2.0) return BANDS[1]
  return BANDS[0]
}

type RubricOverrides = Record<string, Record<string, Record<string, string>>>

function getDescription(pillarId: string, elName: string, bandKey: string, overrides: RubricOverrides): string {
  const ov = overrides?.[pillarId]?.[elName]?.[bandKey]
  if (ov !== undefined) return ov
  const pillar = PILLARS.find(p => p.id === pillarId)
  const el = pillar?.elements.find(e => e.name === elName)
  return (el as any)?.[bandKey] ?? ''
}

export default function RubricPage() {
  const { project, activeEntityId, updateRubric } = useStore()
  const [activePillarId, setActivePillarId] = useState('P1')
  const [editMode, setEditMode] = useState(false)
  const [editedRubric, setEditedRubric] = useState<RubricOverrides>({})
  const [isSaving, setIsSaving] = useState(false)
  const [showRerunBanner, setShowRerunBanner] = useState(false)

  const pillar = PILLARS.find(p => p.id === activePillarId)!
  const entities = project?.entities || []
  const activeEntity = activeEntityId ? entities.find((e: any) => e.id === activeEntityId) : null
  const projectPillars = (activeEntity ? activeEntity.assessment?.pillars : project?.assessment?.pillars) || {}
  const savedRubric: RubricOverrides = ((project as any)?.rubric as RubricOverrides) || {}
  const activeOverrides = editMode ? editedRubric : savedRubric

  function handleEdit() {
    setShowRerunBanner(false)
    // Seed edit state with fully resolved content (defaults merged with any saved overrides)
    // so saving preserves all cells, not just ones previously touched.
    const seed: RubricOverrides = {}
    for (const p of PILLARS) {
      seed[p.id] = {}
      for (const el of p.elements) {
        seed[p.id][el.name] = {}
        for (const band of BANDS) {
          seed[p.id][el.name][band.key] = getDescription(p.id, el.name, band.key, savedRubric)
        }
      }
    }
    setEditedRubric(seed)
    setEditMode(true)
  }

  function handleCellChange(pId: string, elName: string, bandKey: string, value: string) {
    setEditedRubric(prev => ({
      ...prev,
      [pId]: {
        ...(prev[pId] || {}),
        [elName]: {
          ...((prev[pId] || {})[elName] || {}),
          [bandKey]: value,
        }
      }
    }))
  }

  async function handleSave() {
    if (!project) return
    setIsSaving(true)
    try {
      await projectsApi.saveRubric(project.id, editedRubric)
      updateRubric(editedRubric)
      setEditMode(false)
      setShowRerunBanner(true)
    } catch (err) {
      console.error('Failed to save rubric', err)
    } finally {
      setIsSaving(false)
    }
  }

  function handleCancel() {
    setEditedRubric({})
    setEditMode(false)
  }

  async function handleReset() {
    if (!project) return
    setIsSaving(true)
    try {
      await projectsApi.saveRubric(project.id, {})
      updateRubric({})
      setEditedRubric({})
      setEditMode(false)
    } catch (err) {
      console.error('Failed to reset rubric', err)
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden', background: 'var(--sia-bg)' }}>

      {/* Pillar sidebar */}
      <div style={{ width: '220px', flexShrink: 0, background: 'white', borderRight: '1px solid var(--sia-border)', overflowY: 'auto' }}>
        <div style={{ padding: '20px 16px 10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
            <div style={{ width: '28px', height: '28px', borderRadius: '6px', background: 'var(--sia-teal)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <BookOpen size={14} color="white" />
            </div>
            <span style={{ fontFamily: 'var(--font-display)', fontSize: '15px', fontWeight: 700, color: 'var(--sia-navy)' }}>Grading Rubric</span>
          </div>
          <p style={{ fontSize: '11px', color: 'var(--sia-medium-gray)', margin: '4px 0 0', lineHeight: 1.4 }}>5-band scoring criteria for all 8 pillars</p>
          {entities.length > 0 && (
            <div style={{ marginTop: '8px' }}>
              <EntityBanner compact />
            </div>
          )}
        </div>
        <div style={{ padding: '0 0 12px' }}>
          <div style={{ padding: '4px 16px 8px', fontSize: '10px', fontWeight: 600, color: 'var(--sia-medium-gray)', textTransform: 'uppercase', letterSpacing: '1px' }}>Pillars</div>
          {PILLARS.map(p => {
            const pp = projectPillars[p.id]
            const score = pp?.finalScore
            const active = activePillarId === p.id
            const band = score ? getBand(score) : null
            return (
              <button
                key={p.id}
                data-testid={`nav-rubric-${p.id}`}
                onClick={() => setActivePillarId(p.id)}
                style={{ width: '100%', display: 'flex', alignItems: 'center', gap: '10px', padding: '9px 16px', background: active ? `${p.color}12` : 'transparent', borderTop: 'none', borderRight: 'none', borderBottom: 'none', borderLeft: `3px solid ${active ? p.color : 'transparent'}`, cursor: 'pointer', textAlign: 'left', transition: 'all 0.15s' }}
              >
                <div style={{ width: '26px', height: '26px', borderRadius: '6px', background: active ? p.color : 'var(--sia-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <span style={{ fontSize: '10px', fontWeight: 700, color: active ? 'white' : 'var(--sia-navy)' }}>{p.id}</span>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '11px', fontWeight: 600, color: active ? 'var(--sia-navy)' : 'var(--sia-cool-gray)', lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</div>
                  {score && band && (
                    <div style={{ fontSize: '10px', fontWeight: 700, color: band.color }}>{score.toFixed(1)} / 5 · {band.label}</div>
                  )}
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {/* Main content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '24px 28px' }}>

        {/* Pillar header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px', marginBottom: '20px' }}>
          <div style={{ width: '44px', height: '44px', borderRadius: '10px', background: `${pillar.color}20`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <span style={{ fontFamily: 'var(--font-display)', fontSize: '14px', fontWeight: 800, color: pillar.color }}>{pillar.id}</span>
          </div>
          <div>
            <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '20px', fontWeight: 700, color: 'var(--sia-navy)', margin: 0 }}>{pillar.name}</h1>
            <p style={{ fontSize: '13px', color: 'var(--sia-medium-gray)', margin: '2px 0 0' }}>{pillar.elements.length} assessment elements · 5 scoring bands</p>
          </div>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px', alignItems: 'center' }}>
            {!editMode ? (
              <button onClick={handleEdit} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '7px 14px', background: 'var(--sia-teal)', color: 'white', border: 'none', borderRadius: '7px', cursor: 'pointer', fontSize: '12px', fontWeight: 600 }}>
                <Pencil size={13} /> Edit Rubric
              </button>
            ) : (
              <>
                <button onClick={handleReset} disabled={isSaving} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '7px 14px', background: 'transparent', color: 'var(--sia-medium-gray)', border: '1px solid var(--sia-border)', borderRadius: '7px', cursor: isSaving ? 'not-allowed' : 'pointer', fontSize: '12px', fontWeight: 600 }}>
                  <RotateCcw size={13} /> Reset
                </button>
                <button onClick={handleCancel} disabled={isSaving} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '7px 14px', background: 'transparent', color: '#374151', border: '1px solid var(--sia-border)', borderRadius: '7px', cursor: isSaving ? 'not-allowed' : 'pointer', fontSize: '12px', fontWeight: 600 }}>
                  <X size={13} /> Cancel
                </button>
                <button onClick={handleSave} disabled={isSaving} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '7px 14px', background: '#059669', color: 'white', border: 'none', borderRadius: '7px', cursor: isSaving ? 'not-allowed' : 'pointer', fontSize: '12px', fontWeight: 600 }}>
                  <Check size={13} /> {isSaving ? 'Saving…' : 'Save'}
                </button>
              </>
            )}
          </div>
        </div>

        {/* Re-run banner */}
        {showRerunBanner && (
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', padding: '12px 16px', marginBottom: '18px', background: '#FFFBEB', border: '1px solid #FCD34D', borderRadius: '8px' }}>
            <AlertCircle size={16} color="#92400E" style={{ flexShrink: 0, marginTop: '1px' }} />
            <div style={{ flex: 1 }}>
              <span style={{ fontSize: '12px', fontWeight: 600, color: '#92400E' }}>Rubric updated. </span>
              <span style={{ fontSize: '12px', color: '#78350F' }}>Re-run pillar assessments to apply the new scoring criteria to your analysis.</span>
            </div>
            <button onClick={() => setShowRerunBanner(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#92400E', padding: '0', lineHeight: 1 }}>
              <X size={14} />
            </button>
          </div>
        )}

        {/* Band legend */}
        <div style={{ display: 'flex', gap: '6px', marginBottom: '20px', flexWrap: 'wrap' }}>
          {BANDS.map(b => (
            <div key={b.key} style={{ padding: '5px 12px', background: b.bg, borderRadius: '20px', fontSize: '11px', fontWeight: 700, color: b.color, border: `1px solid ${b.color}30` }}>
              {b.range} · {b.label}
            </div>
          ))}
        </div>

        {/* Element tables */}
        {pillar.elements.map((el, elIdx) => {
          const projectPillar = projectPillars[pillar.id]
          const projectEl = projectPillar?.elements?.find((e: any) => e.name === el.name)
          const elScore = projectEl?.manualScore ?? projectEl?.aiScore ?? null
          const elBand = elScore ? getBand(elScore) : null

          return (
            <div key={el.name} data-testid={`rubric-element-${pillar.id}-${elIdx}`} style={{ marginBottom: '16px', background: 'white', borderRadius: '10px', border: '1px solid var(--sia-border)', overflow: 'hidden' }}>
              {/* Element header */}
              <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--sia-border)', display: 'flex', alignItems: 'center', gap: '12px', background: `${pillar.color}08` }}>
                <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: pillar.color, flexShrink: 0 }} />
                <span style={{ fontSize: '14px', fontWeight: 700, color: 'var(--sia-navy)', flex: 1 }}>{el.name}</span>
                {elScore && elBand && (
                  <span style={{ padding: '3px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: 700, background: elBand.bg, color: elBand.color }}>
                    Score {elScore.toFixed(1)} · {elBand.label}
                  </span>
                )}
              </div>

              {/* 5-band grid */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)' }}>
                {BANDS.map((band, bi) => (
                  <div key={band.key} style={{ padding: '14px 12px', borderRight: bi < 4 ? '1px solid var(--sia-border)' : 'none', borderTop: 'none' }}>
                    <div style={{ marginBottom: '8px', padding: '3px 8px', background: band.bg, borderRadius: '4px', display: 'inline-block' }}>
                      <span style={{ fontSize: '10px', fontWeight: 700, color: band.color, whiteSpace: 'nowrap' }}>{band.range}</span>
                      <span style={{ fontSize: '10px', fontWeight: 700, color: band.color }}> · {band.label}</span>
                    </div>
                    {editMode ? (
                      <textarea
                        value={getDescription(pillar.id, el.name, band.key, editedRubric)}
                        onChange={e => handleCellChange(pillar.id, el.name, band.key, e.target.value)}
                        style={{ fontSize: '11px', color: '#374151', lineHeight: 1.5, width: '100%', border: '1px solid var(--sia-teal)', borderRadius: '4px', padding: '4px 6px', resize: 'vertical', minHeight: '80px', outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }}
                      />
                    ) : (
                      <p style={{ fontSize: '11px', color: '#374151', lineHeight: 1.5, margin: 0 }}>{getDescription(pillar.id, el.name, band.key, activeOverrides)}</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
