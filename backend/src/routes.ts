import type { Express, Request, Response, NextFunction } from 'express'
import express from 'express'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'
import crypto from 'crypto'
import { v4 as uuidv4 } from 'uuid'
import { supabase } from './db.js'
import { config } from './config.js'
import { registerSiaGptRoutes } from './siagpt/adapter.js'
import webhooksRouter from './routes/webhooks.js'
import { log } from './logger.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const _require = createRequire(import.meta.url)

// AI is powered by SiaGPT with Claude — see callSiaGPT() below
let _cachedSiaGptToken: string | undefined
let _tokenFetchInFlight: Promise<string> | undefined
let _staticBearerInvalidated = false // set true when static token returns 401/403 so retry uses OAuth2

const UPLOADS_DIR = path.join(__dirname, 'uploads')
const GENERATED_DIR = path.join(UPLOADS_DIR, 'generated')

if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true })
if (!fs.existsSync(GENERATED_DIR)) fs.mkdirSync(GENERATED_DIR, { recursive: true })

// Token-based auth: stateless HMAC tokens.
// Encoding projectId + expiry signed with sessionSecret means every instance
// can verify tokens independently — no shared in-process state required.
const TOKEN_TTL_MS = 8 * 60 * 60 * 1000

function generateProjectToken(projectId: string): string {
  const expires = (Date.now() + TOKEN_TTL_MS).toString(36)
  const payload = Buffer.from(`${projectId}|${expires}`).toString('base64url')
  const sig = crypto.createHmac('sha256', config.sessionSecret).update(payload).digest('base64url')
  return `${payload}.${sig}`
}

function verifyProjectToken(token: string, expectedProjectId: string): boolean {
  const dot = token.lastIndexOf('.')
  if (dot === -1) return false
  const payload = token.slice(0, dot)
  const sig = token.slice(dot + 1)
  const expectedSig = crypto.createHmac('sha256', config.sessionSecret).update(payload).digest('base64url')
  if (sig !== expectedSig) return false
  let decoded: string
  try { decoded = Buffer.from(payload, 'base64url').toString() } catch { return false }
  const pipe = decoded.indexOf('|')
  if (pipe === -1) return false
  return decoded.slice(0, pipe) === expectedProjectId && Date.now() < parseInt(decoded.slice(pipe + 1), 36)
}

async function loadProject(id: string): Promise<any | null> {
  const { data, error } = await supabase.from('projects').select('data').eq('id', id).single()
  if (error || !data) return null
  return data.data
}

async function saveProject(project: any) {
  project.updatedAt = new Date().toISOString()
  const { error } = await supabase.from('projects').upsert({
    id: project.id,
    name: project.name,
    entity_name: project.entityName,
    entity_type: project.entityType,
    password_hash: project.passwordHash,
    data: project,
    updated_at: new Date().toISOString(),
  })
  if (error) throw new Error(error.message)
}

function requireSession(req: Request, res: Response, next: NextFunction) {
  const projectId = req.params.id || req.params.projectId || req.body?.projectId
  // Bearer token check — works cross-origin on all browsers (including Safari ITP)
  const auth = req.headers.authorization
  if (auth?.startsWith('Bearer ') && verifyProjectToken(auth.slice(7), projectId)) return next()
  // Cookie session fallback
  const session = (req as any).session
  if (session?.unlockedProjects?.includes(projectId)) return next()
  res.status(401).json({ error: 'Not authenticated for this project' })
}

function createPillar(id: string, name: string, description: string, elementNames: string[]) {
  return {
    id, name, description,
    aiScore: null, manualScore: null, interviewScore: null, finalScore: null,
    execSummary: { aiDraft: '', edited: '', useEdited: false },
    elements: elementNames.map((eName, i) => ({
      id: `${id}_E${i + 1}`, name: eName,
      aiAnswer: '', evidenceQuote: '', sourceDocument: '',
      aiScore: null, manualScore: null, scoreRationale: '', notes: '', dataGap: null
    })),
    swot: { strengths: [], weaknesses: [], opportunities: [], threats: [] },
    interviewQuestions: [], chatHistory: [], status: 'not_started'
  }
}

function createDefaultEntityAssessment() {
  return {
    pillars: {
      P1: createPillar('P1','Strategic Identity & Vision',"What is the entity's reason for being and where is it headed?",['Mission & Vision Clarity','Strategic Intent','Value Proposition','Strategic Coherence','Parenting Purpose']),
      P2: createPillar('P2','Governance & Leadership','How is the entity governed and led?',['Board Composition & Effectiveness','Leadership Team Capability','Decision-Making Architecture','Accountability & Performance Management','Parenting Style']),
      P3: createPillar('P3','Financial Health & Performance','How financially sound and performant is the entity?',['Revenue Trajectory','Profitability Analysis','Liquidity & Solvency','Cash Flow Quality','Capital Allocation Efficiency','Working Capital Management','Portfolio Financial Contribution']),
      P4: createPillar('P4','Market Position & Competitive Landscape','Where does the entity stand in its market?',['Market Size & Growth','Market Share & Positioning',"Competitive Dynamics (Porter's 5 Forces)",'Customer Concentration & Satisfaction','Competitive Advantage','Portfolio Synergies']),
      P5: createPillar('P5','Operational Excellence & Capabilities','How well does the entity execute?',['Core Competencies','Operational Efficiency','Technology & Digital Maturity','Supply Chain & Partnerships','Innovation Capability','Shared Services & Synergies']),
      P6: createPillar('P6','Organization & People','Is the organization designed and staffed for success?',['Organizational Structure','Talent & Skills','Culture & Values','Employee Engagement','Change Readiness']),
      P7: createPillar('P7','Risk & Resilience','What could go wrong and how prepared is the entity?',['Strategic Risks','Operational Risks','Financial Risks','Regulatory & Compliance','ESG & Sustainability']),
      P8: createPillar('P8','Growth & Strategic Options','Where are the opportunities for value creation?',['Organic Growth Vectors','Inorganic Growth','Portfolio Optimization','Digital & AI Opportunities','Blue Ocean Opportunities','Parenting Advantage Opportunities']),
    },
    consolidatedSwot: { strengths: [], weaknesses: [], opportunities: [], threats: [] },
    strategicHypothesis: { aiDraft: '', edited: '' },
    benchmarkData: {}
  }
}

function defaultOutputs() {
  return {
    D1: { generated: false, content: '', lastGenerated: null },
    D2: { generated: false, content: '', lastGenerated: null },
    D3: { generated: false, content: '', lastGenerated: null },
    D4: { generated: false, content: '', lastGenerated: null },
    D5: { generated: false, content: '', lastGenerated: null },
    D6: { generated: false, content: '', lastGenerated: null },
  }
}

function createDefaultEntity(name: string, type: string) {
  return {
    id: uuidv4(),
    name,
    type: type || 'corporate',
    siagptCollectionId: '',
    documents: [],
    assessment: createDefaultEntityAssessment(),
    outputs: defaultOutputs(),
    strategy: { template: 'government', levelNames: ['Vision', 'Strategic Option', 'Outcome', 'Initiative'], nodes: [] }
  }
}

function applyEntityPillarResult(entity: any, pillarId: string, result: any) {
  const p = entity.assessment.pillars[pillarId]
  if (!p) return
  p.aiScore = result.pillarScore
  p.finalScore = result.pillarScore
  const summary = result.executiveSummary ?? ''
  p.execSummary.aiDraft = summary
  p.execSummary.edited = summary
  const existingElements: any[] = p.elements || []
  p.elements = (result.elements || []).map((el: any, i: number) => {
    const elName = el.name || ''
    const existing = existingElements.find(
      (e: any) => e.name?.toLowerCase().trim() === elName.toLowerCase().trim()
    ) || existingElements[i]
    return {
      id: existing?.id || `${pillarId}_E${i + 1}`,
      name: elName,
      aiAnswer: el.aiAnswer || '',
      evidenceQuote: el.evidenceQuote || '',
      sourceDocument: el.sourceDocument || '',
      aiScore: el.score ?? null,
      manualScore: existing?.manualScore ?? null,
      scoreRationale: el.scoreRationale || '',
      notes: existing?.notes ?? '',
      dataGap: el.dataGap ?? null,
    }
  })
  p.swot = result.swot || { strengths: [], weaknesses: [], opportunities: [], threats: [] }
  const iq = result.interviewQuestions || {}
  p.interviewQuestions = {
    leadership: iq.leadership || [],
    team: iq.team || [],
    gapFilling: iq.gapFilling || [],
  }
  p.missingInfo = result.missingInfo || []
  p.references = result.references || []
  p.status = 'complete'
}

function createDefaultProject(name: string, entityName: string, entityType: string) {
  return {
    id: uuidv4(), name, entityName,
    entityType: entityType || 'government',
    language: 'en',
    webEnrichmentEnabled: false, interviewModeEnabled: false,
    pillarWeights: { P1:1,P2:1,P3:1,P4:1,P5:1,P6:1,P7:1,P8:1 },
    strategyTemplate: 'government', consultantName: '',
    passwordHash: '' as string,
    assessmentDateStart: '', assessmentDateEnd: '',
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    documents: [],
    siagptCollectionId: '',
    entities: [] as any[],
    assessment: {
      pillars: {
        P1: createPillar('P1','Strategic Identity & Vision',"What is the entity's reason for being and where is it headed?",['Mission & Vision Clarity','Strategic Intent','Value Proposition','Strategic Coherence','Parenting Purpose']),
        P2: createPillar('P2','Governance & Leadership','How is the entity governed and led?',['Board Composition & Effectiveness','Leadership Team Capability','Decision-Making Architecture','Accountability & Performance Management','Parenting Style']),
        P3: createPillar('P3','Financial Health & Performance','How financially sound and performant is the entity?',['Revenue Trajectory','Profitability Analysis','Liquidity & Solvency','Cash Flow Quality','Capital Allocation Efficiency','Working Capital Management','Portfolio Financial Contribution']),
        P4: createPillar('P4','Market Position & Competitive Landscape','Where does the entity stand in its market?',['Market Size & Growth','Market Share & Positioning',"Competitive Dynamics (Porter's 5 Forces)",'Customer Concentration & Satisfaction','Competitive Advantage','Portfolio Synergies']),
        P5: createPillar('P5','Operational Excellence & Capabilities','How well does the entity execute?',['Core Competencies','Operational Efficiency','Technology & Digital Maturity','Supply Chain & Partnerships','Innovation Capability','Shared Services & Synergies']),
        P6: createPillar('P6','Organization & People','Is the organization designed and staffed for success?',['Organizational Structure','Talent & Skills','Culture & Values','Employee Engagement','Change Readiness']),
        P7: createPillar('P7','Risk & Resilience','What could go wrong and how prepared is the entity?',['Strategic Risks','Operational Risks','Financial Risks','Regulatory & Compliance','ESG & Sustainability']),
        P8: createPillar('P8','Growth & Strategic Options','Where are the opportunities for value creation?',['Organic Growth Vectors','Inorganic Growth','Portfolio Optimization','Digital & AI Opportunities','Blue Ocean Opportunities','Parenting Advantage Opportunities']),
      },
      consolidatedSwot: { strengths: [], weaknesses: [], opportunities: [], threats: [] },
      strategicHypothesis: { aiDraft: '', edited: '' },
      benchmarkData: {}
    },
    strategy: { template: 'government', levelNames: ['Vision','Strategic Option','Outcome','Initiative'], nodes: [] },
    outputs: defaultOutputs()
  }
}

const SCORING_RUBRIC = `Score 1 (Critical/Absent): Element is absent or severely underdeveloped.
Score 2 (Weak/Early Stage): Element exists but is ad-hoc and inconsistent.
Score 3 (Developing/Adequate): Functional, meets basic requirements.
Score 4 (Strong/Advanced): Well-developed, consistent, above average for sector.
Score 5 (Excellent/Best-in-Class): Sector-leading practice.`

// ─── DEFAULT PER-PILLAR GRADING RUBRIC ───────────────────────────────────────
// Keyed by pillarId → element name → band descriptor.
// Used as the fallback when project.rubric has no custom override for a cell.
// Names are stored in both routes.ts form AND RubricPage.tsx form so the
// normalised-name lookup resolves regardless of minor name variations.
const DEFAULT_RUBRIC: Record<string, Record<string, {
  critical: string; weak: string; developing: string; strong: string; excellent: string
}>> = {
  P1: {
    'Mission & Vision Clarity': {
      critical:   'No mission/vision exists or is purely ceremonial with no strategic direction',
      weak:       'Mission exists but is generic, not differentiated or actively referenced by leadership',
      developing: 'Clear mission exists, referenced occasionally but not embedded in decision-making',
      strong:     'Compelling, differentiated mission actively used to guide strategy and resource allocation',
      excellent:  'Mission is a living strategic compass, consistently referenced, externally recognized, drives all decisions',
    },
    'Strategic Intent': {
      critical:   'No defined strategic ambition or 3-5 year goals exist',
      weak:       'Goals exist but are vague, not time-bound, or internally contradictory',
      developing: 'Strategic intent is documented but lacks SMART criteria or clear accountability',
      strong:     'Clear SMART ambition with defined milestones, owned by leadership, regularly reviewed',
      excellent:  'Bold, inspiring, fully measurable ambition that motivates stakeholders and guides all strategic choices',
    },
    'Value Proposition': {
      critical:   'No articulated value proposition; unclear what unique value the entity delivers',
      weak:       'Value proposition exists but is generic and indistinguishable from peers',
      developing: 'Value proposition is defined but inconsistently communicated across stakeholders',
      strong:     'Clear, differentiated value proposition understood by all key stakeholders',
      excellent:  'Industry-recognized value proposition, regularly validated with stakeholders, drives competitive advantage',
    },
    'Strategic Coherence': {
      critical:   'Significant contradictions between stated strategy and actual resource allocation or priorities',
      weak:       'Partial alignment; some strategic elements conflict or are siloed across departments',
      developing: 'General alignment but gaps exist between strategy documents and operational priorities',
      strong:     'Strong coherence across vision, strategy, and execution with regular alignment checks',
      excellent:  'Perfect strategic coherence; every initiative, budget, and decision traces back to the core strategy',
    },
    'Parenting Purpose': {
      critical:   'No clear theory of how the holding creates value for subsidiaries',
      weak:       'Holding role is primarily financial with no strategic value-add to subsidiaries',
      developing: 'Some parenting value defined but inconsistently applied across the portfolio',
      strong:     'Clear parenting model (financial/strategic/operational) with measurable value-add per subsidiary',
      excellent:  'Best-in-class parenting model; holding is a recognized value multiplier across all subsidiaries',
    },
  },
  P2: {
    'Board Composition & Effectiveness': {
      critical:   'Board lacks required skills, independence, or meets irregularly with no clear mandate',
      weak:       'Board exists but dominated by insiders; limited independence or relevant expertise',
      developing: 'Board has basic structure but committees are inactive or lack authority',
      strong:     'Diverse, independent board with active committees and clear terms of reference',
      excellent:  'Board recognized for governance excellence; proactive, diverse, fully independent with measurable impact',
    },
    'Leadership Team Capability': {
      critical:   'Critical leadership roles vacant or filled by unqualified individuals',
      weak:       'Leadership team in place but significant skill gaps in key strategic areas',
      developing: 'Competent leadership with targeted gaps; succession planning is informal',
      strong:     'High-caliber leadership team with formal succession plans and development programs',
      excellent:  'World-class leadership team; recognized externally, with deep bench strength and active succession pipeline',
    },
    'Decision-Making Architecture': {
      critical:   'Decisions are ad-hoc with no clear authority matrix or governance framework',
      weak:       'Some governance processes exist but frequently bypassed or unclear',
      developing: 'Delegation of authority exists but is inconsistently applied across departments',
      strong:     'Clear decision rights framework, consistently applied, with appropriate escalation paths',
      excellent:  'Optimized decision architecture enabling speed and accountability at all levels',
    },
    'Accountability & Performance Management': {
      critical:   'No performance management system; leaders not held accountable for outcomes',
      weak:       'KPIs exist but are not cascaded or consistently measured',
      developing: 'Performance framework in place but incentives weakly linked to strategic outcomes',
      strong:     'Robust performance management with KPI cascading, regular reviews, and consequence management',
      excellent:  'Performance culture fully embedded; transparent metrics, real-time tracking, and merit-based accountability',
    },
    'Parenting Style': {
      critical:   'No defined parenting model; the holding exercises no discernible governance role',
      weak:       'Holding acts purely as a passive financial owner; no strategic or operational support is extended',
      developing: 'Parenting style is partially defined (e.g., financial holding with selective strategic input) but inconsistently applied across the portfolio',
      strong:     'Clear parenting model is defined, documented, and consistently applied across subsidiaries with measurable value-add',
      excellent:  'Best-in-class parenting model; precisely calibrated per subsidiary, dynamically adjusted, recognized as primary value driver',
    },
  },
  P3: {
    'Revenue Trajectory': {
      critical:   'Declining revenues with no credible recovery plan or diversification strategy',
      weak:       'Flat or marginal growth below sector benchmarks; high revenue concentration risk',
      developing: 'Moderate growth in line with market but limited diversification of revenue streams',
      strong:     'Consistent above-market revenue growth with diversified and resilient revenue mix',
      excellent:  'Exceptional revenue growth with fully diversified streams and strong forward visibility',
    },
    'Profitability Analysis': {
      critical:   'Operating at a loss with no clear path to profitability',
      weak:       'Thin or volatile margins significantly below sector peers',
      developing: 'Adequate margins but cost structure optimization opportunities remain significant',
      strong:     'Healthy margins above sector average with consistent improvement trend',
      excellent:  'Best-in-class margins through optimized cost structure and high-value revenue mix',
    },
    'Liquidity & Solvency': {
      critical:   'Immediate liquidity concerns; unable to meet near-term obligations',
      weak:       'Adequate current liquidity but concerning medium-term solvency indicators',
      developing: 'Sufficient liquidity with manageable debt levels; limited financial flexibility',
      strong:     'Strong liquidity position with comfortable debt ratios and access to capital',
      excellent:  'Exceptional financial strength; significant reserves, minimal debt, and multiple capital access options',
    },
    'Cash Flow Quality': {
      critical:   'Negative operating cash flow; reliant on external financing for operations',
      weak:       'Positive but volatile cash flow with high capex intensity limiting free cash',
      developing: 'Consistent operating cash flow but working capital management needs improvement',
      strong:     'Strong, predictable operating cash flow with disciplined capital allocation',
      excellent:  'Exceptional cash generation with optimized working capital and high free cash flow conversion',
    },
    'Capital Allocation Efficiency': {
      critical:   'No disciplined capital allocation framework; investments made without ROI assessment',
      weak:       'Basic investment criteria exist but returns consistently below cost of capital',
      developing: 'Capital allocation process in place but not fully linked to strategic priorities',
      strong:     'Disciplined capital allocation with returns consistently above cost of capital',
      excellent:  'World-class capital allocation; rigorous portfolio optimization with measurable value creation',
    },
    'Portfolio Financial Contribution': {
      critical:   'No visibility into subsidiary financial performance; no consolidated view of value creation',
      weak:       'Basic subsidiary financials are available but not systematically analyzed',
      developing: 'Subsidiary contributions are tracked periodically; some value creation analysis exists but lacks rigor',
      strong:     'Clear financial contribution framework per subsidiary; value creators and underperformers identified',
      excellent:  'Dynamic portfolio financial intelligence; each subsidiary\'s value contribution measured against cost of capital',
    },
  },
  P4: {
    'Market Size & Growth': {
      critical:   'No understanding of addressable market size or growth trajectory',
      weak:       'Basic market data available but analysis is outdated or incomplete',
      developing: 'Market sizing conducted but TAM/SAM/SOM segmentation lacks rigor',
      strong:     'Comprehensive, current market intelligence with validated TAM/SAM/SOM analysis',
      excellent:  'Deep market intelligence capability; real-time monitoring with predictive market trend analysis',
    },
    'Market Share & Positioning': {
      critical:   'Unknown or declining market share with no differentiated positioning',
      weak:       'Marginal market presence; positioning is unclear or easily replicated by competitors',
      developing: 'Established market presence but positioning is not strongly differentiated',
      strong:     'Clear market leadership in target segments with defensible positioning',
      excellent:  'Dominant market position with recognized brand equity and pricing power',
    },
    "Competitive Dynamics (Porter's 5 Forces)": {
      critical:   'No competitive intelligence; unaware of key competitor moves or disruptive threats',
      weak:       'Basic competitor tracking exists but no systematic analysis or strategic response',
      developing: 'Competitive landscape mapped but monitoring is reactive rather than proactive',
      strong:     'Systematic competitive intelligence with proactive strategic responses to market changes',
      excellent:  'Sophisticated competitive intelligence function; anticipates shifts and shapes market dynamics',
    },
    'Competitive Dynamics': {
      critical:   'No competitive intelligence; unaware of key competitor moves or disruptive threats',
      weak:       'Basic competitor tracking exists but no systematic analysis or strategic response',
      developing: 'Competitive landscape mapped but monitoring is reactive rather than proactive',
      strong:     'Systematic competitive intelligence with proactive strategic responses to market changes',
      excellent:  'Sophisticated competitive intelligence function; anticipates shifts and shapes market dynamics',
    },
    'Customer Concentration & Satisfaction': {
      critical:   'No customer satisfaction data; high dependency on a single customer or segment',
      weak:       'High customer concentration risk; satisfaction data collected but not acted upon',
      developing: 'Customer satisfaction tracked; some diversification but concentration risk remains',
      strong:     'Diversified customer base with high satisfaction scores and strong retention metrics',
      excellent:  'Loyal, diversified customer base with world-class NPS and proactive relationship management',
    },
    'Competitive Advantage': {
      critical:   'No identifiable sustainable competitive advantage or differentiating capability',
      weak:       'Advantage exists but is temporary, easily imitated, or eroding',
      developing: 'Clear competitive advantage in specific areas but not consistently leveraged',
      strong:     'Well-defined, defensible competitive advantages across multiple dimensions',
      excellent:  'Multiple reinforcing competitive advantages creating a durable moat; continuously strengthened',
    },
    'Portfolio Synergies': {
      critical:   'No awareness or mapping of synergies across subsidiaries; entities operate in isolation, no cross-selling',
      weak:       'Synergy opportunities are informally discussed but not structured or tracked; cross-selling is ad-hoc',
      developing: 'Synergy mapping conducted; some cross-selling and shared customer initiatives underway but inconsistent',
      strong:     'Synergies actively managed; cross-selling programs and shared customer strategies delivering tangible benefits',
      excellent:  'Portfolio synergies are a primary competitive advantage; quantified synergy realization tracked at board level',
    },
  },
  P5: {
    'Core Competencies': {
      critical:   'Core capabilities are unclear or misaligned with strategic needs',
      weak:       'Some capabilities identified but not systematically developed or leveraged',
      developing: 'Core competencies defined but gaps exist relative to strategic requirements',
      strong:     'Well-defined core competencies aligned to strategy with active development programs',
      excellent:  'World-class capabilities in strategic areas; recognized externally, continuously refined',
    },
    'Operational Efficiency': {
      critical:   'Significant operational inefficiencies; high cost base with no improvement roadmap',
      weak:       'Efficiency initiatives exist but are fragmented and not systematically measured',
      developing: 'Operational efficiency improving but still below sector benchmarks',
      strong:     'Operations consistently efficient; measurable productivity above sector average',
      excellent:  'Best-in-class operational efficiency; continuous improvement culture with lean practices embedded',
    },
    'Technology & Digital Maturity': {
      critical:   'Legacy systems dominate; no digital strategy or transformation roadmap',
      weak:       'Digital initiatives underway but fragmented; technology investment below sector norms',
      developing: 'Digital transformation in progress with clear roadmap but execution gaps remain',
      strong:     'Modern technology stack; digital capabilities embedded in core operations',
      excellent:  'Digital-first organization; AI and advanced analytics drive competitive advantage',
    },
    'Supply Chain & Partnerships': {
      critical:   'Supply chain is fragile; single-source dependencies and no contingency planning',
      weak:       'Partnerships exist but are transactional with limited strategic value creation',
      developing: 'Supply chain is adequate; strategic partnerships developing but not fully optimized',
      strong:     'Resilient supply chain with diversified partners and clear value-sharing frameworks',
      excellent:  'Ecosystem of strategic partnerships delivering measurable competitive advantage; fully resilient',
    },
    'Innovation Capability': {
      critical:   'No formal innovation process; ideas not captured or developed',
      weak:       'Innovation efforts are ad-hoc with no governance, funding, or success metrics',
      developing: 'Innovation program exists but limited pipeline and inconsistent commercialization',
      strong:     'Structured innovation process with dedicated resources and measurable pipeline',
      excellent:  'Innovation is a core competency; consistent track record of breakthrough products/services',
    },
    'Shared Services & Synergies': {
      critical:   'No shared services exist; each subsidiary independently duplicates all central functions',
      weak:       'Shared services partially initiated but cover only basic functions; minimal cost savings',
      developing: 'Shared services center exists for select functions; adoption uneven and value-add not consistently measured',
      strong:     'Well-established shared services model; subsidiaries benefit from measurable cost efficiencies and capability uplift',
      excellent:  'Group-wide shared services platform at best-in-class efficiency; delivers strategic value beyond cost savings',
    },
  },
  P6: {
    'Organizational Structure': {
      critical:   'Structure is misaligned to strategy; significant overlap, gaps, or fragmentation',
      weak:       'Structure partially aligned but creates inefficiencies and accountability gaps',
      developing: 'Organizational design is adequate but not optimized for strategic priorities',
      strong:     'Structure clearly aligned to strategy with defined roles and lean decision layers',
      excellent:  'Agile, future-ready organizational design; continuously adapted to strategic needs',
    },
    'Talent & Skills': {
      critical:   'Critical skills gaps across the organization with no structured development plan',
      weak:       'Talent strategy exists but not linked to strategic workforce requirements',
      developing: 'Workforce planning in place; some skill gaps remain in key strategic areas',
      strong:     'Strong talent pipeline with skills closely matched to current and future needs',
      excellent:  'Talent is a strategic asset; top employer brand, exceptional retention, future-ready workforce',
    },
    'Culture & Values': {
      critical:   'Culture is toxic, misaligned, or actively undermining strategic performance',
      weak:       'Values are defined but not lived; culture is inconsistent across teams',
      developing: 'Culture aligns with stated values but reinforcement mechanisms are limited',
      strong:     'Strong, positive culture actively reinforced by leaders and embedded in practices',
      excellent:  'Culture is a recognized competitive advantage; externally celebrated and consistently high-performing',
    },
    'Employee Engagement': {
      critical:   'Very low engagement; high attrition, absenteeism, or visible disengagement',
      weak:       'Engagement measured but below sector average with no credible action plan',
      developing: 'Adequate engagement levels with targeted initiatives showing some improvement',
      strong:     'High engagement scores with robust listening mechanisms and action follow-through',
      excellent:  'Exceptional engagement; employees are brand ambassadors with best-in-class retention',
    },
    'Change Readiness': {
      critical:   'Organization consistently resists change; past transformations have failed',
      weak:       'Change management capability is limited; initiatives face significant resistance',
      developing: 'Change readiness developing; structured change programs in place with mixed results',
      strong:     'Organization navigates change effectively with structured methodologies and high adoption',
      excellent:  'Change agility is a core strength; continuous adaptation with high success rate on transformations',
    },
  },
  P7: {
    // Both names stored to handle routes.ts vs RubricPage name variation
    'Strategic Risks': {
      critical:   'No strategic risk identification or mitigation; operating blindly to existential threats',
      weak:       'Risks identified informally but not quantified, owned, or actively managed',
      developing: 'Risk register exists but not integrated into strategic planning or decision-making',
      strong:     'Comprehensive strategic risk management with clear ownership and mitigation plans',
      excellent:  'Risk management is a strategic advantage; proactive horizon scanning with scenario planning embedded',
    },
    'Strategic Risk Management': {
      critical:   'No strategic risk identification or mitigation; operating blindly to existential threats',
      weak:       'Risks identified informally but not quantified, owned, or actively managed',
      developing: 'Risk register exists but not integrated into strategic planning or decision-making',
      strong:     'Comprehensive strategic risk management with clear ownership and mitigation plans',
      excellent:  'Risk management is a strategic advantage; proactive horizon scanning with scenario planning embedded',
    },
    'Operational Risks': {
      critical:   'Major operational failures occur regularly; no documented controls or response plans',
      weak:       'Basic controls exist but inconsistently applied; incident response is reactive',
      developing: 'Controls documented and tested periodically; business continuity plans in development',
      strong:     'Robust operational controls with regular testing and clear incident response protocols',
      excellent:  'Operational resilience is a hallmark; zero critical failures, continuous monitoring, rapid recovery',
    },
    'Operational Risk Controls': {
      critical:   'Major operational failures occur regularly; no documented controls or response plans',
      weak:       'Basic controls exist but inconsistently applied; incident response is reactive',
      developing: 'Controls documented and tested periodically; business continuity plans in development',
      strong:     'Robust operational controls with regular testing and clear incident response protocols',
      excellent:  'Operational resilience is a hallmark; zero critical failures, continuous monitoring, rapid recovery',
    },
    'Financial Risks': {
      critical:   'Uncontrolled financial risks (FX, credit, liquidity) with no hedging strategy',
      weak:       'Financial risks identified but hedging is partial or not aligned to policy',
      developing: 'Risk limits defined and mostly adhered to; some exposures remain unmitigated',
      strong:     'Financial risks well-managed with appropriate hedging and within approved limits',
      excellent:  'Optimized financial risk management; minimal exposure with sophisticated risk instruments employed',
    },
    'Financial Risk Exposure': {
      critical:   'Uncontrolled financial risks (FX, credit, liquidity) with no hedging strategy',
      weak:       'Financial risks identified but hedging is partial or not aligned to policy',
      developing: 'Risk limits defined and mostly adhered to; some exposures remain unmitigated',
      strong:     'Financial risks well-managed with appropriate hedging and within approved limits',
      excellent:  'Optimized financial risk management; minimal exposure with sophisticated risk instruments employed',
    },
    'Regulatory & Compliance': {
      critical:   'Significant compliance failures or regulatory breaches; no compliance program',
      weak:       'Compliance function exists but is reactive; some regulatory gaps identified',
      developing: 'Compliance program in place with regular audits; minor gaps being addressed',
      strong:     'Full regulatory compliance with proactive monitoring and a strong audit trail',
      excellent:  'Compliance excellence; regulatory relationships are collaborative and the entity shapes standards',
    },
    'ESG & Sustainability': {
      critical:   'No ESG strategy or reporting; significant reputational or regulatory exposure',
      weak:       'Basic ESG awareness but no targets, reporting framework, or accountability',
      developing: 'ESG strategy formulated with initial targets; reporting underway but gaps remain',
      strong:     'Comprehensive ESG strategy with measurable targets, verified reporting, and stakeholder disclosure',
      excellent:  'ESG leader; targets aligned to global standards, externally verified, with quantified impact delivered',
    },
  },
  P8: {
    'Organic Growth Vectors': {
      critical:   'No identified organic growth opportunities; reliant entirely on existing business',
      weak:       'Growth levers identified but not resourced or actively pursued',
      developing: 'Organic growth initiatives underway with some traction but lacking scale',
      strong:     'Multiple funded organic growth vectors with clear milestones and accountability',
      excellent:  'Organic growth engine fully operational; consistently outpacing market with proven playbooks',
    },
    'Inorganic Growth': {
      critical:   'No M&A capability or strategy; past deals have destroyed value',
      weak:       'M&A considered opportunistically with no structured pipeline or integration capability',
      developing: 'M&A strategy defined with initial pipeline; integration capability being developed',
      strong:     'Active M&A pipeline with disciplined screening, due diligence, and integration track record',
      excellent:  'M&A is a core strategic capability; consistent value-creating deal flow with best-in-class integration',
    },
    'Portfolio Optimization': {
      critical:   'No portfolio review process; underperforming entities retain capital indefinitely',
      weak:       'Portfolio reviewed informally; divestiture decisions lack rigor or are avoided',
      developing: 'Portfolio assessment conducted periodically; some optimization actions taken',
      strong:     'Active portfolio management with clear investment thesis per entity and regular rebalancing',
      excellent:  'Dynamic portfolio management; continuous optimization delivering superior returns across the portfolio',
    },
    'Digital & AI Opportunities': {
      critical:   'No awareness or plans to leverage digital/AI for growth or efficiency',
      weak:       'Digital opportunities identified but no budget or roadmap committed',
      developing: 'Digital growth initiatives launched; AI use cases in pilot stage',
      strong:     'AI and digital initiatives delivering measurable growth and efficiency gains',
      excellent:  'AI-powered business model; digital capabilities are a primary source of competitive differentiation',
    },
    'Blue Ocean Opportunities': {
      critical:   'Entirely focused on existing markets; no exploration of uncontested spaces',
      weak:       'Adjacent market opportunities discussed but not rigorously evaluated',
      developing: 'Blue ocean analysis conducted; some initiatives exploring new value frontiers',
      strong:     'Structured process to identify and test uncontested market opportunities',
      excellent:  'Proven ability to create new market spaces; multiple successful blue ocean moves executed',
    },
    'Parenting Advantage Opportunities': {
      critical:   'No portfolio review process; underperforming entities retain capital indefinitely',
      weak:       'Portfolio reviewed informally; divestiture decisions lack rigor or are avoided',
      developing: 'Portfolio assessment conducted periodically; some optimization actions taken',
      strong:     'Active portfolio management with clear investment thesis per entity and regular rebalancing',
      excellent:  'Dynamic portfolio management; continuous optimization delivering superior returns across the portfolio',
    },
  },
}

/** Normalize an element name for fuzzy lookup (lowercase alphanumeric only). */
function normalizeElName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '')
}

/**
 * Builds the grading rubric section for the given pillar.
 * For each element, it first checks project.rubric for user-saved overrides,
 * then falls back to DEFAULT_RUBRIC. Name matching is normalised so minor
 * variations (e.g. "Strategic Risks" vs "Strategic Risk Management") still resolve.
 */
function buildRubricSection(project: any, pillarId: string): string {
  const pillar = project.assessment.pillars[pillarId]
  const savedRubric: Record<string, Record<string, Record<string, string>>> = project.rubric || {}
  const savedPillar = savedRubric[pillarId] || {}
  const defaultPillar = DEFAULT_RUBRIC[pillarId] || {}

  // Build normalised-key lookup maps
  const normDefault: Record<string, { critical: string; weak: string; developing: string; strong: string; excellent: string }> = {}
  for (const [k, v] of Object.entries(defaultPillar)) normDefault[normalizeElName(k)] = v

  const normSaved: Record<string, Record<string, string>> = {}
  for (const [k, v] of Object.entries(savedPillar)) normSaved[normalizeElName(k)] = v

  const BAND_DEFS: Array<[string, string, string]> = [
    ['critical',   '1.0–<2.0', 'Critical'],
    ['weak',       '2.0–<3.0', 'Weak'],
    ['developing', '3.0–<3.5', 'Developing'],
    ['strong',     '3.5–<4.5', 'Strong'],
    ['excellent',  '4.5–5.0',  'Exemplary'],
  ]

  const lines: string[] = [
    'GRADING RUBRIC — score each element from 1 to 5:',
    'Bands: 1.0–<2.0 Critical | 2.0–<3.0 Weak | 3.0–<3.5 Developing | 3.5–<4.5 Strong | 4.5–5.0 Exemplary',
    'Pillar score = average of element scores. RAG: ≤2.4 RED | 2.5–3.4 AMBER | ≥3.5 GREEN',
    '',
  ]

  const elementNames: string[] = (pillar.elements || []).map((e: any) => e.name as string)
  for (const elName of elementNames) {
    const nk = normalizeElName(elName)
    const savedEl = normSaved[nk] || {}
    const defEl   = normDefault[nk] || {}
    lines.push(`[${elName}]`)
    for (const [key, range, label] of BAND_DEFS) {
      const desc = (savedEl[key] || defEl[key as keyof typeof defEl] || '').trim()
      if (desc) lines.push(`  Score ${range} (${label}): ${desc}`)
    }
    lines.push('')
  }

  return lines.join('\n').trimEnd()
}

function getAgentPersona(pillarId: string): string {
  const personas: Record<string, string> = {
    P1: 'You are an expert strategic analyst specializing in organizational vision, mission clarity, and strategic intent assessment. Your role is to evaluate an entity\'s Strategic Identity & Vision across its key assessment elements using the 8-Pillar Strategy Assessment Framework. You have 20+ years of experience advising governments and sovereign entities in the GCC on mission clarity, strategic coherence, and value proposition design.',
    P2: 'You are a Corporate Governance Expert specializing in board effectiveness, leadership capability, and decision-making architecture. Your role is to evaluate an entity\'s Governance & Leadership across its key assessment elements using the 8-Pillar Strategy Assessment Framework. You have extensive experience with complex holding entities and government-linked organizations.',
    P3: 'You are a Chief Financial Analyst specializing in financial health diagnostics for government entities, SWFs, and holding companies. Your role is to evaluate an entity\'s Financial Health & Performance across its key assessment elements using the 8-Pillar Strategy Assessment Framework. You are expert in revenue trajectory analysis, capital allocation, and portfolio financial performance.',
    P4: 'You are a Market Intelligence Strategist with expertise in GCC competitive landscapes and market positioning. Your role is to evaluate an entity\'s Market Position & Competitive Landscape across its key assessment elements using the 8-Pillar Strategy Assessment Framework. You specialize in Porter\'s Five Forces analysis for both private and public sector entities.',
    P5: 'You are an Operational Excellence Consultant with deep expertise in digital maturity assessment and process efficiency benchmarking. Your role is to evaluate an entity\'s Operational Excellence & Capabilities across its key assessment elements using the 8-Pillar Strategy Assessment Framework. You specialize in innovation capability building for complex organizations.',
    P6: 'You are an Organizational Design and Talent Specialist with 15+ years of experience in HR diagnostics, culture assessment, and change readiness evaluation. Your role is to evaluate an entity\'s Organization & People across its key assessment elements using the 8-Pillar Strategy Assessment Framework. You specialize in large government entities.',
    P7: 'You are an Enterprise Risk Management Expert specializing in strategic risk, operational resilience, regulatory compliance, and ESG integration. Your role is to evaluate an entity\'s Risk & Resilience across its key assessment elements using the 8-Pillar Strategy Assessment Framework. You focus on public sector and holding entities.',
    P8: 'You are a Growth Strategy Advisor specializing in organic and inorganic growth vectors and digital transformation opportunities. Your role is to evaluate an entity\'s Growth & Strategic Options across its key assessment elements using the 8-Pillar Strategy Assessment Framework. You focus on strategic option development for entities operating in the GCC.',
  }
  return `${personas[pillarId] || 'You are a senior strategy consultant at SIA Partners.'}\n\n`
}

function buildSystemPrompt(project: any) {
  return `You are an expert strategy consultant at SIA Partners. Assess ${project.entityName} (${project.entityType}) using the 8-pillar framework.

${SCORING_RUBRIC}

Return valid JSON exactly matching the schema. Be evidence-based. Flag data gaps. Never fabricate.`
}

/**
 * Builds a self-contained assessment prompt that embeds the exact JSON schema
 * (with correct element names for this pillar) so the AI always returns output
 * that maps 1-to-1 to what the backend parser and UI expect.
 */
function buildAssessmentPrompt(project: any, pillarId: string): string {
  const pillar = project.assessment.pillars[pillarId]
  const elementNames: string[] = pillar.elements.map((e: any) => e.name)

  const elementsTemplate = elementNames.map(name => `    {
      "name": ${JSON.stringify(name)},
      "aiAnswer": "• Bullet finding 1\\n• Bullet finding 2\\n• Bullet finding 3",
      "evidenceQuote": "Verbatim quote from documents or 'Not found in documents'",
      "sourceDocument": "Exact filename as found in RAG or 'N/A'",
      "score": 0,
      "scoreRationale": "2-3 sentences citing specific document evidence that justifies this score.",
      "dataGap": "Specific missing information that would improve this assessment, or null"
    }`).join(',\n')

  return `${getAgentPersona(pillarId)}You are assessing ${project.entityName} (${project.entityType}) for Pillar ${pillarId}: ${pillar.name}.
${pillar.description}

${buildRubricSection(project, pillarId)}

Analyze all documents available to you and produce a complete, evidence-based assessment. Never fabricate data. For any element where evidence is insufficient, state the gap explicitly.

═══════════════════════════════════════════════════════════
OUTPUT REQUIREMENTS — STRICT JSON FORMAT
═══════════════════════════════════════════════════════════
Return ONLY valid JSON. No markdown. No text before or after the JSON block.
All string values must be properly escaped. Use EXACTLY this structure with EXACTLY these field names:

{
  "pillarScore": 0.0,
  "executiveSummary": "• Key finding 1\\n• Key finding 2\\n• Key finding 3\\n• Key finding 4\\n• Key finding 5",
  "elements": [
${elementsTemplate}
  ],
  "swot": {
    "strengths": ["Specific strength directly evidenced in documents", "Second specific strength from documents"],
    "weaknesses": ["Specific weakness identified in documents", "Second specific weakness from documents"],
    "opportunities": ["Opportunity suggested by strategic analysis of documents", "Second opportunity from analysis"],
    "threats": ["Risk or threat identified in documents", "Second threat from documents"]
  },
  "interviewQuestions": {
    "leadership": [
      "Dynamically generated question 1 referencing a specific finding or gap",
      "Dynamically generated question 2 referencing a specific finding or gap"
    ],
    "team": [
      "Dynamically generated question 1 referencing a specific finding or gap",
      "Dynamically generated question 2 referencing a specific finding or gap"
    ],
    "gapFilling": [
      {
        "gap": "Exact description of the missing data point from your analysis",
        "question": "Hyper-specific question to retrieve this exact missing data",
        "element": "The element name this gap belongs to"
      }
    ]
  },
  "missingInfo": [
    {
      "item": "Specific missing data point identified during analysis",
      "impact": "How this gap reduces assessment accuracy or confidence",
      "priority": "high",
      "suggestedSource": "Specific document type, system, or person who holds this data"
    }
  ],
  "references": [
    {
      "title": "Full title of source document used",
      "url": "Direct URL or 'N/A'",
      "type": "One of: Official Report, Academic, Statistical, Regulatory, Strategy Document",
      "relevance": "One sentence explaining why this source is relevant to this pillar.",
      "publishedBy": "Organization name",
      "year": "YYYY"
    }
  ]
}`
}

// ====== SIAGPT HELPERS ======

async function getSiaGptToken(): Promise<string> {
  if (_cachedSiaGptToken) return _cachedSiaGptToken
  // If a fetch is already in-flight (e.g. multiple parallel callers), reuse it
  if (_tokenFetchInFlight) return _tokenFetchInFlight

  // Use static bearer token if configured (dev/testing shortcut).
  // Skip if it has already been invalidated by a 401/403 — forces fallthrough to OAuth2.
  if (config.siagptBearerToken && !_staticBearerInvalidated) {
    _cachedSiaGptToken = config.siagptBearerToken
    return _cachedSiaGptToken
  }
  const { oauth2TokenUrl, oauth2ClientId, oauth2ClientSecret, zitadelProjectId } = config
  if (!oauth2TokenUrl || !oauth2ClientId || !oauth2ClientSecret || !zitadelProjectId) {
    throw new Error('SiaGPT OAuth2 credentials not configured')
  }
  const authStr = Buffer.from(`${oauth2ClientId}:${oauth2ClientSecret}`).toString('base64')
  const scopeParams = [
    'openid',
    'urn:zitadel:iam:user:resourceowner',
    `urn:zitadel:iam:org:project:id:${zitadelProjectId}:aud`,
    'urn:zitadel:iam:org:projects:roles',
  ].join('+')

  _tokenFetchInFlight = (async () => {
    const response = await fetch(
      `${oauth2TokenUrl}?grant_type=client_credentials&scope=${scopeParams}`,
      { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${authStr}` } },
    )
    if (!response.ok) {
      const body = await response.text()
      throw new Error(`SiaGPT auth failed ${response.status}: ${body}`)
    }
    const tokenData = await response.json() as any
    const access = tokenData.access_token
    const id = tokenData.id_token
    const token = access?.split('.').length === 3 ? access : id ?? access
    if (!token) throw new Error('No usable JWT in SiaGPT OAuth2 response')
    _cachedSiaGptToken = token
    return token
  })()

  try {
    return await _tokenFetchInFlight
  } finally {
    _tokenFetchInFlight = undefined
  }
}

async function deleteSiaGPTCollection(collectionId: string): Promise<void> {
  if (!collectionId || !config.siagptBaseUrl) return
  const doDelete = async () => {
    const token = await getSiaGptToken()
    return fetch(`${config.siagptBaseUrl}/medias/collections/${collectionId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}`, 'app-origin': 'AI Platform' },
    })
  }
  try {
    let resp = await doDelete()
    if (resp.status === 401 || resp.status === 403) {
      _cachedSiaGptToken = undefined
      _staticBearerInvalidated = true // prevent re-loading the same expired static token
      resp = await doDelete()
    }
    if (!resp.ok) {
      const body = await resp.text()
      log.warn(`SiaGPT collection deletion failed for ${collectionId}: ${resp.status} ${body}`)
    }
  } catch (e: any) {
    log.error('SiaGPT collection deletion error', e)
  }
}

async function createSiaGPTCollection(name: string, description: string): Promise<string | null> {
  if (!config.siagptMediaFolderId) return null
  const doCreate = async () => {
    const token = await getSiaGptToken()
    return fetch(`${config.siagptBaseUrl}/medias/collections`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'app-origin': 'AI Platform' },
      body: JSON.stringify({ name, description, folderId: config.siagptMediaFolderId }),
    })
  }
  try {
    log.collectionRequest(name, description, config.siagptMediaFolderId)
    let resp = await doCreate()
    if (resp.status === 401 || resp.status === 403) {
      _cachedSiaGptToken = undefined
      _staticBearerInvalidated = true // prevent re-loading the same expired static token
      resp = await doCreate()
    }
    if (!resp.ok) {
      const body = await resp.text()
      log.warn(`SiaGPT collection creation failed: ${resp.status} ${body}`)
      log.collectionResponse(null, name)
      return null
    }
    const data = await resp.json() as any
    log.collectionResponse(data.uuid || null, name)
    return data.uuid || null
  } catch (e: any) {
    log.error('SiaGPT collection creation error', e)
    log.collectionResponse(null, name)
    return null
  }
}

async function uploadDocToSiaGPTCollection(filePath: string, fileName: string, mimetype: string, collectionId: string): Promise<string | null> {
  const doUpload = async () => {
    const token = await getSiaGptToken()
    const fileBuffer = fs.readFileSync(filePath)
    const blob = new Blob([fileBuffer], { type: mimetype })
    const formData = new FormData()
    formData.append('file', blob, fileName)
    formData.append('media_metadata', JSON.stringify({ collectionId }))
    return fetch(`${config.siagptBaseUrl}/medias/`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'app-origin': 'AI Platform', Accept: 'application/json' },
      body: formData,
    })
  }
  try {
    log.docUploadRequest(fileName, mimetype, collectionId)
    let resp = await doUpload()
    if (resp.status === 401) {
      // Token expired — refresh and retry once.
      _cachedSiaGptToken = undefined
      _staticBearerInvalidated = true
      resp = await doUpload()
    } else if (resp.status === 403) {
      // Permission denied — the collection was likely created by a different user/token.
      // Retrying with a refreshed token for the same service account won't change the outcome.
      // The caller (upload route) pre-verifies the collection and recreates it when this happens,
      // so reaching this path after that fix should be extremely rare.
      const permBody = await resp.text()
      log.warn(`SiaGPT media upload 403 on collection ${collectionId} — file "${fileName}": ${permBody}. Collection may belong to a different owner.`)
      log.docUploadResponse(fileName, false, 403)
      return null
    }
    if (!resp.ok) {
      const body = await resp.text()
      log.warn(`SiaGPT media upload failed: ${resp.status} ${body}`)
      log.docUploadResponse(fileName, false, resp.status)
      return null
    }
    const data = await resp.json() as any
    log.docUploadResponse(fileName, true)
    return data.uuid || null
  } catch (e: any) {
    log.error('SiaGPT media upload error', e)
    log.docUploadResponse(fileName, false)
    return null
  }
}

interface SiaGPTResult {
  text: string
  /** Sources from the NEW_SOURCES SSE event, keyed by source number string */
  newSources: Record<string, { id: string; type: string; url?: string; header?: string; description?: string }>
  /** Download URL returned by the generate_file tool, if the agent used it */
  fileUrl?: string
  /** Filename extracted from the generate_file widget (e.g. "Report.docx") */
  fileName?: string
}

async function callSiaGPT(
  prompt: string,
  options?: {
    assistantId?: string
    collectionIds?: string[]
    tools?: string[]
    context?: string   // human-readable label shown in logs, e.g. "pillar P1 assessment"
    timeoutMs?: number  // AbortController timeout on the SiaGPT message call (default: 10 min)
  }
): Promise<SiaGPTResult> {
  let token: string
  try { token = await getSiaGptToken() } catch (e) { throw e }
  const baseUrl = config.siagptBaseUrl
  const projectId = config.siagptProjectId
  const ctx = options?.context ?? 'LLM call'

  // 1. Create discussion
  const discName = `SIA Assessment ${Date.now()}`
  const ownerId = config.siagptOwnerId
  log.discussionRequest(discName, ownerId)
  const discResp = await fetch(`${baseUrl}/chat/discussions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'app-origin': 'AI Platform' },
    body: JSON.stringify({ name: discName, ownerId, ownerType: 'USER' }),
  })
  if (!discResp.ok) {
    if (discResp.status === 401) _cachedSiaGptToken = undefined
    throw new Error(`SiaGPT discussion creation failed: ${discResp.status}`)
  }
  const { uuid: discussionId } = await discResp.json() as any
  log.discussionResponse(discussionId)

  // 2. Post message and get response
  const { v7: uuidv7 } = await import('uuid')
  const effectiveAssistantId = options?.assistantId || config.siagptAssistantId || undefined
  const msgMeta: Record<string, any> = {
    ...(effectiveAssistantId ? { assistantId: effectiveAssistantId } : {}),
    attachmentInfos: [],
    tools: options?.tools ?? ['rag', 'document_content', 'list_documents', 'query_table', 'list_table_schemas'],
    ...(options?.collectionIds?.length ? { collectionIds: options.collectionIds } : {}),
    ...(config.siagptBundleId ? { bundleId: config.siagptBundleId } : {}),
  }
  const messageId = uuidv7()
  const msgPayload = {
    question: prompt,
    messageId,
    discussionId,
    ownerId,
    ownerType: 'USER',
    messageMetadata: msgMeta,
  }
  log.messageRequest({ ...msgPayload, context: ctx })
  const msgTimeoutMs = options?.timeoutMs ?? 10 * 60 * 1000 // default 10 minutes
  const msgAbort = new AbortController()
  const msgAbortTimer = setTimeout(() => msgAbort.abort(), msgTimeoutMs)
  let msgResp: globalThis.Response
  try {
    msgResp = await fetch(`${baseUrl}/chat/messages/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'app-origin': 'AI Platform' },
      body: JSON.stringify(msgPayload),
      signal: msgAbort.signal,
    })
  } finally {
    clearTimeout(msgAbortTimer)
  }
  if (!msgResp.ok) {
    if (msgResp.status === 401) _cachedSiaGptToken = undefined
    const errBody = await msgResp.text()
    log.messageError(`${msgResp.status}: ${errBody}`, ctx)
    throw new Error(`SiaGPT message failed: ${msgResp.status}`)
  }

  const raw = await msgResp.text()
  log.rawResponse(raw, ctx)
  // Parse NDJSON or single JSON — prefer OVERWRITE_TEXT then CHAT event
  let chosenEvent = 'raw'
  let result: string
  let newSources: Record<string, any> = {}

  let fileUrl: string | undefined
  let fileName: string | undefined

  function extractNewSources(events: any[]) {
    for (const e of events) {
      if (e?.event === 'NEW_SOURCES' && e.sources) {
        Object.assign(newSources, e.sources)
      }
    }
  }

  function extractFileInfo(events: any[], text: string): { url?: string; name?: string } {
    // Accumulate every data-carrying string from every event into one blob,
    // then search the whole blob for the https link — works regardless of which
    // event type carries the file URL (NEW_TEXT, NEW_WIDGET, OVERWRITE_TEXT, etc.)
    const parts: string[] = []
    for (const e of events as any[]) {
      // e.data is a plain string (NEW_TEXT, NEW_THINKING, OVERWRITE_TEXT, RENAME_DISCUSSION…)
      if (typeof e.data === 'string' && e.data) parts.push(e.data)
      // e.data is an object with a .value string (some NEW_WIDGET payloads)
      if (e.data && typeof e.data === 'object' && typeof e.data.value === 'string') parts.push(e.data.value)
      // top-level url / path / downloadUrl fields
      if (typeof e.url === 'string' && e.url) parts.push(e.url)
      if (typeof e.path === 'string' && e.path) parts.push(e.path)
      if (typeof e.downloadUrl === 'string' && e.downloadUrl) parts.push(e.downloadUrl)
    }
    // also include the final response text (OVERWRITE_TEXT / CHAT chosen value)
    if (text) parts.push(text)

    const cumulative = parts.join('\n')

    // 1. Collect ALL markdown links and use the LAST one — the agent can generate
    //    the file multiple times; the last link is always the freshest.
    const mdMatches = [...cumulative.matchAll(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g)]
    if (mdMatches.length > 0) {
      const last = mdMatches[mdMatches.length - 1]
      const name = last[1].replace(/^Download\s+/i, '').trim()
      return { name: name || last[1], url: last[2] }
    }
    // 2. Bare https URLs — pick the last one
    const urlMatches = [...cumulative.matchAll(/https?:\/\/[^\s\n<>"')\]]+/g)]
    if (urlMatches.length > 0) {
      const lastUrl = urlMatches[urlMatches.length - 1][0].replace(/[.,)>\]]+$/, '')
      return { url: lastUrl }
    }
    return {}
  }

  try {
    const parsed = JSON.parse(raw)
    const events: any[] = Array.isArray(parsed) ? parsed : [parsed]
    extractNewSources(events)
    const errorEvent = events.find(e => e.event === 'NEW_ERROR')
    if (errorEvent) throw new Error(`SiaGPT error: ${errorEvent.error ?? JSON.stringify(errorEvent)}`)
    const chosen = events.find(e => e.event === 'OVERWRITE_TEXT') ??
      events.find(e => e.event === 'CHAT') ??
      events[events.length - 1]
    chosenEvent = chosen?.event ?? 'json'
    result = String(chosen?.data ?? chosen?.content ?? raw)
    const info1 = extractFileInfo(events, result)
    fileUrl = info1.url
    fileName = info1.name
  } catch (e: any) {
    if (e.message?.startsWith('SiaGPT error:')) throw e
    // Strip SSE 'data: ' prefix before attempting JSON parse
    const events = raw.split('\n').filter(l => l.trim()).map(l => { const p = l.startsWith('data: ') ? l.slice(6) : l; try { return JSON.parse(p) } catch { return null } }).filter(Boolean)
    if (events.length > 0) {
      extractNewSources(events)
      const errorEvent = (events as any[]).find(e => e.event === 'NEW_ERROR')
      if (errorEvent) throw new Error(`SiaGPT error: ${errorEvent.error ?? JSON.stringify(errorEvent)}`)
      const chosen = (events as any[]).find(e => e.event === 'OVERWRITE_TEXT') ??
        (events as any[]).find(e => e.event === 'CHAT') ??
        events[events.length - 1]
      chosenEvent = (chosen as any)?.event ?? 'ndjson'
      result = String((chosen as any)?.data ?? (chosen as any)?.content ?? raw)
      const info2 = extractFileInfo(events, result)
      fileUrl = info2.url
      fileName = info2.name
    } else {
      result = raw
    }
  }
  log.messageResponse(result, chosenEvent, ctx)
  return { text: result, newSources, fileUrl, fileName }
}

/**
 * Downloads a file from a (possibly expiring) URL and saves it under
 * GENERATED_DIR/{projectId}/{reportType}/{filename} so it can be served
 * indefinitely via /api/files/generated/:projectId/:reportType/:filename.
 */
async function downloadAndPersistFile(
  remoteUrl: string,
  projectId: string,
  reportType: string,
  suggestedName?: string,
): Promise<{ serveUrl: string; filename: string }> {
  const dlAbort = new AbortController()
  const dlAbortTimer = setTimeout(() => dlAbort.abort(), 5 * 60 * 1000) // 5-minute download timeout
  let resp: globalThis.Response
  try {
    resp = await fetch(remoteUrl, { redirect: 'follow', signal: dlAbort.signal })
  } finally {
    clearTimeout(dlAbortTimer)
  }
  if (!resp.ok) throw new Error(`Failed to download generated file: HTTP ${resp.status}`)

  // Resolve filename: suggested → Content-Disposition → URL path → fallback
  let filename = (suggestedName || '').trim()
  if (!filename) {
    const cd = resp.headers.get('content-disposition') || ''
    const cdMatch = cd.match(/filename[^;=\n]*=\s*["']?([^"'\n;]+)/)
    if (cdMatch) filename = cdMatch[1].trim().replace(/^"|"$/g, '')
  }
  if (!filename) {
    try {
      const urlPath = new URL(remoteUrl).pathname
      const base = path.basename(urlPath)
      if (base && base !== '/') filename = base
    } catch { /* ignore malformed URL */ }
  }
  if (!filename) filename = `${reportType.toLowerCase()}_report.docx`

  // Sanitize: keep only alphanumeric, dot, underscore, hyphen
  filename = filename.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/_{2,}/g, '_')

  const dir = path.join(GENERATED_DIR, projectId, reportType)
  fs.mkdirSync(dir, { recursive: true })
  const localPath = path.join(dir, filename)

  const buffer = Buffer.from(await resp.arrayBuffer())
  fs.writeFileSync(localPath, buffer)

  const serveUrl = `/api/files/generated/${encodeURIComponent(projectId)}/${encodeURIComponent(reportType)}/${encodeURIComponent(filename)}`
  return { serveUrl, filename }
}

async function* streamSiaGPTResponse(text: string, res: Response, chunkSize = 50) {
  for (let i = 0; i < text.length; i += chunkSize) {
    const chunk = text.slice(i, i + chunkSize)
    res.write(`data: ${JSON.stringify({ chunk })}\n\n`)
    await new Promise(r => setTimeout(r, 20))
  }
}

const MAX_ASSESSMENT_RETRIES = 2

function parseJsonFromText(text: string): any {
  let cleaned = text
    .replace(/```json\n?/gi, '')
    .replace(/```\n?/gi, '')
    .trim()
  const start = cleaned.indexOf('{')
  if (start === -1) throw new Error('No JSON object found in SiaGPT response')
  // Use bracket-counting to find the matching closing brace,
  // so concatenated JSON objects (e.g. two responses merged) don't cause parse errors.
  let depth = 0, inString = false, escape = false, end = -1
  for (let i = start; i < cleaned.length; i++) {
    const ch = cleaned[i]
    if (escape) { escape = false; continue }
    if (ch === '\\' && inString) { escape = true; continue }
    if (ch === '"') { inString = !inString; continue }
    if (inString) continue
    if (ch === '{') depth++
    else if (ch === '}') { depth--; if (depth === 0) { end = i; break } }
  }
  if (end === -1) throw new Error('Malformed JSON in SiaGPT response')
  return JSON.parse(cleaned.slice(start, end + 1))
}

// ====== ROUTE REGISTRATION ======
export function registerRoutes(httpServer: any, app: Express) {
  app.use(express.json({ limit: '10mb' }))

  // Config endpoint
  app.get('/api/config', (_req: Request, res: Response) => {
    res.json({ provider: 'siagpt-claude' })
  })

  // ====== GENERATED FILE DOWNLOAD ======
  // Serves files that were downloaded from SiaGPT's S3 storage and persisted
  // locally so that download links never expire.
  app.get('/api/files/generated/:projectId/:reportType/:filename', requireSession, (req: Request, res: Response) => {
    const { projectId, reportType, filename } = req.params
    // Prevent path traversal: only allow the basename of each segment
    const safeProjectId = path.basename(String(projectId))
    const safeReportType = path.basename(String(reportType))
    const safeFilename  = path.basename(String(filename))
    const filePath = path.join(GENERATED_DIR, safeProjectId, safeReportType, safeFilename)
    // Ensure the resolved path stays inside GENERATED_DIR
    if (!filePath.startsWith(GENERATED_DIR + path.sep) && filePath !== GENERATED_DIR) {
      return res.status(400).json({ error: 'Invalid file path' })
    }
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Generated file not found' })
    }
    res.download(filePath, safeFilename)
  })

  // ====== PROJECT ROUTES ======
  app.post('/api/projects', async (req: Request, res: Response) => {
    try {
      const bcrypt = await import('bcryptjs')
      const { name, entityName, entityType, password, consultantName, entities: entitiesInput } = req.body
      if (!name || !entityName || !password) return res.status(400).json({ error: 'name, entityName, and password are required' })
      const project = createDefaultProject(name, entityName, entityType)
      project.passwordHash = await bcrypt.default.hash(password, 12)
      project.consultantName = consultantName || ''

      // Build entity list from input (holding company gets its own collection, plus one per subsidiary)
      const validEntities: Array<{ name: string; type: string }> = []
      if (Array.isArray(entitiesInput)) {
        for (const ei of entitiesInput) {
          if (ei?.name?.trim()) validEntities.push({ name: ei.name.trim(), type: ei.type || 'corporate' })
        }
      }

      if (config.siagptMediaFolderId) {
        // Authenticate once — all parallel collection calls below will reuse the cached token
        await getSiaGptToken()

        // Create the holding company's collection first — this is required to proceed
        const holdingCollId = await createSiaGPTCollection(
          entityName,
          `SIA Partners strategy assessment collection for ${entityName}`,
        )
        if (!holdingCollId) {
          return res.status(503).json({
            error: `Failed to create SiaGPT document collection for "${entityName}". Please retry — this is usually a temporary connectivity issue.`,
            retryable: true,
          })
        }
        project.siagptCollectionId = holdingCollId

        // Create entity collections in parallel — entities whose collection fails are excluded
        const entityCollResults = await Promise.all(
          validEntities.map(async e => {
            const collId = await createSiaGPTCollection(e.name, `SIA Partners strategy assessment collection for ${e.name}`)
            return { entity: e, collId }
          })
        )
        const failedEntities: string[] = []
        for (const { entity, collId } of entityCollResults) {
          if (!collId) {
            log.warn(`Skipping entity "${entity.name}" — SiaGPT collection creation failed`)
            failedEntities.push(entity.name)
            continue
          }
          const ent = createDefaultEntity(entity.name, entity.type)
          ent.siagptCollectionId = collId
          project.entities.push(ent)
        }

        await saveProject(project)
        log.projectCreate(name, entityName, project.id)
        const session = (req as any).session
        if (!session.unlockedProjects) session.unlockedProjects = []
        session.unlockedProjects.push(project.id)
        const token = generateProjectToken(project.id)
        const { passwordHash: _ph, ...safeProject } = project
        return res.json({
          token,
          project: safeProject,
          ...(failedEntities.length ? {
            warnings: failedEntities.map(n =>
              `Entity "${n}" was not added — its SiaGPT document collection could not be created. You can add it again from the Setup page.`
            ),
          } : {}),
        })
      } else {
        // No SiaGPT configured — create entities without collections
        for (const e of validEntities) {
          project.entities.push(createDefaultEntity(e.name, e.type))
        }
      }

      await saveProject(project)
      log.projectCreate(name, entityName, project.id)
      const session = (req as any).session
      if (!session.unlockedProjects) session.unlockedProjects = []
      session.unlockedProjects.push(project.id)
      const token = generateProjectToken(project.id)
      const { passwordHash: _ph, ...safeProject } = project
      res.json({ token, project: safeProject })
    } catch (err: any) { res.status(500).json({ error: err.message }) }
  })

  app.post('/api/projects/:id/unlock', async (req: Request, res: Response) => {
    try {
      const bcrypt = await import('bcryptjs')
      const project = await loadProject(req.params.id as string)
      if (!project) return res.status(404).json({ error: 'Project not found' })
      const valid = await bcrypt.default.compare(req.body.password, project.passwordHash)
      if (!valid) return res.status(401).json({ error: 'Invalid password' })
      const session = (req as any).session
      if (!session.unlockedProjects) session.unlockedProjects = []
      if (!session.unlockedProjects.includes(project.id)) session.unlockedProjects.push(project.id)
      const token = generateProjectToken(project.id)
      const { passwordHash: _ph2, ...safeProject } = project
      res.json({ success: true, token, project: safeProject })
    } catch (err: any) { res.status(500).json({ error: err.message }) }
  })

  app.get('/api/projects', async (_req: Request, res: Response) => {
    try {
      const { data: rows, error } = await supabase
        .from('projects')
        .select('id, name, entity_name, entity_type, data')
        .order('updated_at', { ascending: false })
      if (error) return res.status(500).json({ error: error.message })
      res.json((rows ?? []).map((r: any) => ({
        id: r.id,
        name: r.name,
        entityName: r.entity_name,
        entityType: r.entity_type,
        updatedAt: r.data?.updatedAt,
        createdAt: r.data?.createdAt,
      })))
    } catch (err: any) { res.status(500).json({ error: err.message }) }
  })

  app.get('/api/projects/:id', requireSession, async (req: Request, res: Response) => {
    try {
      const project = await loadProject(req.params.id as string)
      if (!project) return res.status(404).json({ error: 'Not found' })
      const { passwordHash, ...safe } = project
      res.json(safe)
    } catch (err: any) { res.status(500).json({ error: err.message }) }
  })

  app.put('/api/projects/:id', requireSession, async (req: Request, res: Response) => {
    try {
      const existing = await loadProject(req.params.id as string)
      if (!existing) return res.status(404).json({ error: 'Not found' })
      const updated = { ...existing, ...req.body, id: existing.id, passwordHash: existing.passwordHash }
      await saveProject(updated)
      res.json({ success: true })
    } catch (err: any) { res.status(500).json({ error: err.message }) }
  })

  app.patch('/api/projects/:id/pillar/:pillarId', requireSession, async (req: Request, res: Response) => {
    try {
      const project = await loadProject(req.params.id as string)
      if (!project) return res.status(404).json({ error: 'Not found' })
      const pillarId = req.params.pillarId as string
      project.assessment.pillars[pillarId] = { ...project.assessment.pillars[pillarId], ...req.body }
      await saveProject(project)
      res.json({ success: true })
    } catch (err: any) { res.status(500).json({ error: err.message }) }
  })

  app.patch('/api/projects/:id/entities/:entityId/pillar/:pillarId', requireSession, async (req: Request, res: Response) => {
    try {
      const project = await loadProject(req.params.id as string)
      if (!project) return res.status(404).json({ error: 'Not found' })
      const entity = (project.entities || []).find((e: any) => e.id === req.params.entityId)
      if (!entity) return res.status(404).json({ error: 'Entity not found' })
      const pillarId = req.params.pillarId as string
      entity.assessment.pillars[pillarId] = { ...entity.assessment.pillars[pillarId], ...req.body }
      await saveProject(project)
      res.json({ success: true })
    } catch (err: any) { res.status(500).json({ error: err.message }) }
  })

  app.patch('/api/projects/:id/strategy', requireSession, async (req: Request, res: Response) => {
    try {
      const project = await loadProject(req.params.id as string)
      if (!project) return res.status(404).json({ error: 'Not found' })
      project.strategy = { ...project.strategy, ...req.body }
      await saveProject(project)
      res.json({ success: true })
    } catch (err: any) { res.status(500).json({ error: err.message }) }
  })

  app.patch('/api/projects/:id/rubric', requireSession, async (req: Request, res: Response) => {
    try {
      const project = await loadProject(req.params.id as string)
      if (!project) return res.status(404).json({ error: 'Not found' })
      project.rubric = req.body
      await saveProject(project)
      res.json({ success: true })
    } catch (err: any) { res.status(500).json({ error: err.message }) }
  })

  app.patch('/api/projects/:id/entities/:entityId/strategy', requireSession, async (req: Request, res: Response) => {
    try {
      const project = await loadProject(req.params.id as string)
      if (!project) return res.status(404).json({ error: 'Not found' })
      const entity = (project.entities || []).find((e: any) => e.id === req.params.entityId)
      if (!entity) return res.status(404).json({ error: 'Entity not found' })
      const defaultStrategy = { template: 'government', levelNames: ['Vision', 'Strategic Option', 'Outcome', 'Initiative'], nodes: [] }
      entity.strategy = { ...(entity.strategy || defaultStrategy), ...req.body }
      await saveProject(project)
      res.json({ success: true })
    } catch (err: any) { res.status(500).json({ error: err.message }) }
  })

  app.delete('/api/projects/:id', requireSession, async (req: Request, res: Response) => {
    try {
      const project = await loadProject(req.params.id as string)
      if (project) {
        // Collect all SiaGPT collection IDs (main project + all entities)
        const collectionIds: string[] = []
        if (project.siagptCollectionId) collectionIds.push(project.siagptCollectionId)
        for (const entity of (project.entities || [])) {
          if (entity.siagptCollectionId) collectionIds.push(entity.siagptCollectionId)
        }
        // Delete all collections in parallel; don't fail the whole request if SiaGPT is unreachable
        await Promise.allSettled(collectionIds.map(id => deleteSiaGPTCollection(id)))
      }
      await supabase.from('projects').delete().eq('id', req.params.id)
      res.json({ success: true })
    } catch (err: any) { res.status(500).json({ error: err.message }) }
  })

  // ====== DOCUMENT ROUTES ======
  app.post('/api/documents/:projectId/upload', requireSession, async (req: Request, res: Response) => {
    const multer = await import('multer')
    const storageConf = multer.default.diskStorage({
      destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
      filename: (_req, file, cb) => cb(null, `${uuidv4()}_${file.originalname}`)
    })
    const upload = multer.default({
      storage: storageConf,
      limits: { fileSize: 50 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        const allowed = ['application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.openxmlformats-officedocument.presentationml.presentation','application/msword','application/vnd.ms-excel','image/png','image/jpeg','image/jpg']
        allowed.includes(file.mimetype) ? cb(null, true) : cb(new Error(`File type ${file.mimetype} not supported`))
      }
    })
    upload.array('files', 20)(req as any, res as any, async (err: any) => {
      if (err) return res.status(400).json({ error: err.message })
      try {
        const project = await loadProject(req.params.projectId as string)
        if (!project) return res.status(404).json({ error: 'Project not found' })
        const { docType, docLabel } = req.body
        const files = (req as any).files as any[]
        const results = []
        // Authenticate once before uploading all files so every upload reuses the same token
        if (project.siagptCollectionId) await getSiaGptToken().catch(() => {})
        for (const file of files) {
          const extractedText = await extractText(file.path, file.mimetype, file.originalname)
          const doc: any = { id: uuidv4(), name: file.originalname, type: docType || 'general', label: docLabel || file.originalname, mimetype: file.mimetype, size: file.size, extractedText, uploadedAt: new Date().toISOString(), wordCount: extractedText.split(/\s+/).filter(Boolean).length, siagptMediaId: '' }
          project.documents.push(doc)
          if (project.siagptCollectionId) {
            const mediaId = await uploadDocToSiaGPTCollection(file.path, file.originalname, file.mimetype, project.siagptCollectionId)
            if (mediaId) doc.siagptMediaId = mediaId
          }
          try { fs.unlinkSync(file.path) } catch (e) {}
          results.push({ id: doc.id, name: doc.name, type: doc.type, wordCount: doc.wordCount, preview: extractedText.substring(0, 300), siagptMediaId: doc.siagptMediaId })
        }
        await saveProject(project)
        res.json({ success: true, documents: results })
      } catch (err: any) { res.status(500).json({ error: err.message }) }
    })
  })

  app.delete('/api/documents/:projectId/:docId', requireSession, async (req: Request, res: Response) => {
    try {
      const project = await loadProject(req.params.projectId as string)
      if (!project) return res.status(404).json({ error: 'Project not found' })
      project.documents = project.documents.filter((d: any) => d.id !== req.params.docId)
      await saveProject(project)
      res.json({ success: true })
    } catch (err: any) { res.status(500).json({ error: err.message }) }
  })

  app.get('/api/documents/:projectId/:docId/text', requireSession, async (req: Request, res: Response) => {
    try {
      const project = await loadProject(req.params.projectId as string)
      if (!project) return res.status(404).json({ error: 'Project not found' })
      const doc = project.documents.find((d: any) => d.id === req.params.docId)
      if (!doc) return res.status(404).json({ error: 'Document not found' })
      res.json({ text: doc.extractedText, name: doc.name })
    } catch (err: any) { res.status(500).json({ error: err.message }) }
  })

  app.get('/api/documents/:projectId/embedding-status', requireSession, async (req: Request, res: Response) => {
    try {
      const project = await loadProject(req.params.projectId as string)
      if (!project) return res.status(404).json({ error: 'Project not found' })
      // No collection yet — return completion 1.0 for all docs immediately
      if (!project.siagptCollectionId) {
        const status: Record<string, number> = {}
        for (const doc of project.documents) status[doc.name] = 1.0
        return res.json({ status })
      }
      const token = await getSiaGptToken()
      const resp = await fetch(`${config.siagptBaseUrl}/medias/collections/${project.siagptCollectionId}?get_medias=true`, {
        headers: { Authorization: `Bearer ${token}`, 'app-origin': 'AI Platform' },
      })
      if (!resp.ok) return res.json({ status: {} })
      const data = await resp.json() as any
      const medias: any[] = data.medias || []
      const status: Record<string, number> = {}
      for (const media of medias) {
        if (media.name) status[media.name] = typeof media.completion === 'number' ? media.completion : 0
      }
      res.json({ status })
    } catch (err: any) { res.status(500).json({ error: err.message }) }
  })

  // ====== AI ROUTES ======

  // Pillar Assessment — SSE streaming
  app.post('/api/ai/:projectId/assess/:pillarId', requireSession, async (req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')

    try {
      const project = await loadProject(req.params.projectId as string)
      if (!project) { res.write(`data: ${JSON.stringify({ error: 'Project not found' })}\n\n`); return res.end() }

      const pillarId = req.params.pillarId as string
      const pillar = project.assessment.pillars[pillarId]

      let result: any
      let newSources: Record<string, any> = {}

      {
        const collIds = project.siagptCollectionId ? [project.siagptCollectionId] : []
        const prompt = buildAssessmentPrompt(project, pillarId)
        const siaResult = await callSiaGPT(prompt, {
          assistantId: config.pillarAssistantIds[pillarId],
          collectionIds: collIds,
          context: `pillar ${pillarId} assessment — ${pillar.name}`,
        })
        newSources = siaResult.newSources
        // Stream text chunks to client if still connected; ignore disconnect errors
        try { for await (const _ of streamSiaGPTResponse(siaResult.text, res, 50)) {} } catch { /* client disconnected — continue to save */ }
        const parsed = parseJsonFromText(siaResult.text)
        result = parsed.pillarAssessment ?? parsed
      }

      const p = project.assessment.pillars[pillarId]
      p.aiScore = result.pillarScore
      p.finalScore = result.pillarScore
      const summary = result.executiveSummary ?? ''
      p.execSummary.aiDraft = summary
      p.execSummary.edited = summary

      // Match AI elements to existing elements by name to preserve manual scores and notes.
      // Since buildAssessmentPrompt injects the exact element names, el.name always matches.
      const existingElements: any[] = p.elements || []
      p.elements = (result.elements || []).map((el: any, i: number) => {
        const elName = el.name || ''
        const existing = existingElements.find(
          (e: any) => e.name?.toLowerCase().trim() === elName.toLowerCase().trim()
        ) || existingElements[i]
        return {
          id: existing?.id || `${pillarId}_E${i + 1}`,
          name: elName,
          aiAnswer: el.aiAnswer || '',
          evidenceQuote: el.evidenceQuote || '',
          sourceDocument: el.sourceDocument || '',
          aiScore: el.score ?? null,
          manualScore: existing?.manualScore ?? null,
          scoreRationale: el.scoreRationale || '',
          notes: existing?.notes ?? '',
          dataGap: el.dataGap ?? null,
        }
      })

      // Schema guarantees swot.strengths/weaknesses/opportunities/threats
      p.swot = result.swot || { strengths: [], weaknesses: [], opportunities: [], threats: [] }

      // Schema guarantees interviewQuestions.leadership / team / gapFilling
      const iq = result.interviewQuestions || {}
      p.interviewQuestions = {
        leadership: iq.leadership || [],
        team: iq.team || [],
        gapFilling: iq.gapFilling || [],
      }

      p.missingInfo = result.missingInfo || []
      p.references = result.references || []
      p.newSources = newSources
      p.status = 'complete'
      await saveProject(project)

      try { res.write(`data: ${JSON.stringify({ done: true, pillarId, score: result.pillarScore })}\n\n`) } catch { /* disconnected */ }
      res.end()
    } catch (err: any) {
      try { res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`) } catch { /* disconnected */ }
      res.end()
    }
  })

  // Batch Pillar Assessment — SSE streaming (parallel SiaGPT calls, single atomic save)
  app.post('/api/ai/:projectId/assess-batch', requireSession, async (req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.flushHeaders()

    try {
      const project = await loadProject(req.params.projectId as string)
      if (!project) {
        res.write(`data: ${JSON.stringify({ error: 'Project not found' })}\n\n`)
        return res.end()
      }

      const { pillarIds } = req.body
      const validIds: string[] = (Array.isArray(pillarIds) ? pillarIds : [])
        .filter((id: string) => typeof id === 'string' && project.assessment.pillars[id])

      if (validIds.length === 0) {
        res.write(`data: ${JSON.stringify({ error: 'No valid pillar IDs specified' })}\n\n`)
        return res.end()
      }

      const collIds = project.siagptCollectionId ? [project.siagptCollectionId] : []
      const results: Record<string, any> = {}
      const errors: Record<string, string> = {}

      log.info(`[batch-assess] Firing ${validIds.length} parallel SiaGPT calls: ${validIds.join(', ')} — t=${Date.now()}`)

      // Run all SiaGPT calls in parallel — all start simultaneously, each retries up to MAX_ASSESSMENT_RETRIES times
      await Promise.allSettled(
        validIds.map(async (pillarId: string) => {
          const t0 = Date.now()
          log.info(`[batch-assess] START pillar ${pillarId} — t=${t0}`)
          let lastError: Error | undefined
          for (let attempt = 0; attempt <= MAX_ASSESSMENT_RETRIES; attempt++) {
            try {
              if (attempt > 0) {
                log.info(`[batch-assess] RETRY ${attempt}/${MAX_ASSESSMENT_RETRIES} for pillar ${pillarId}`)
                try { res.write(`data: ${JSON.stringify({ pillarId, retrying: true, attempt })}\n\n`) } catch { /* disconnected */ }
              }
              const prompt = buildAssessmentPrompt(project, pillarId)
              const { text: rawText, newSources } = await callSiaGPT(prompt, {
                assistantId: config.pillarAssistantIds[pillarId],
                collectionIds: collIds,
                context: `pillar ${pillarId} assessment (batch, attempt ${attempt + 1}) — ${project.assessment.pillars[pillarId].name}`,
              })
              const parsed = parseJsonFromText(rawText)
              results[pillarId] = { ...(parsed.pillarAssessment ?? parsed), _newSources: newSources }
              log.info(`[batch-assess] DONE pillar ${pillarId} — ${Date.now() - t0}ms`)
              try { res.write(`data: ${JSON.stringify({ pillarId, progress: true, score: results[pillarId].pillarScore })}\n\n`) } catch { /* disconnected */ }
              return // success — exit retry loop
            } catch (err: any) {
              lastError = err
              log.info(`[batch-assess] ERROR pillar ${pillarId} (attempt ${attempt + 1}) — ${err.message}`)
            }
          }
          // All retries exhausted
          errors[pillarId] = lastError!.message
          try { res.write(`data: ${JSON.stringify({ pillarId, error: lastError!.message })}\n\n`) } catch { /* disconnected */ }
        })
      )

      // Apply all successful results atomically: load fresh project, apply all, save once
      if (Object.keys(results).length > 0) {
        const freshProject = await loadProject(req.params.projectId as string)
        if (freshProject) {
          for (const [pillarId, result] of Object.entries(results)) {
            const p = freshProject.assessment.pillars[pillarId]
            if (!p) continue
            p.aiScore = result.pillarScore
            p.finalScore = result.pillarScore
            const summary = result.executiveSummary ?? ''
            p.execSummary.aiDraft = summary
            p.execSummary.edited = summary
            const existingElements: any[] = p.elements || []
            p.elements = (result.elements || []).map((el: any, i: number) => {
              const elName = el.name || ''
              const existing = existingElements.find(
                (e: any) => e.name?.toLowerCase().trim() === elName.toLowerCase().trim()
              ) || existingElements[i]
              return {
                id: existing?.id || `${pillarId}_E${i + 1}`,
                name: elName,
                aiAnswer: el.aiAnswer || '',
                evidenceQuote: el.evidenceQuote || '',
                sourceDocument: el.sourceDocument || '',
                aiScore: el.score ?? null,
                manualScore: existing?.manualScore ?? null,
                scoreRationale: el.scoreRationale || '',
                notes: existing?.notes ?? '',
                dataGap: el.dataGap ?? null,
              }
            })
            p.swot = result.swot || { strengths: [], weaknesses: [], opportunities: [], threats: [] }
            const iq = result.interviewQuestions || {}
            p.interviewQuestions = {
              leadership: iq.leadership || [],
              team: iq.team || [],
              gapFilling: iq.gapFilling || [],
            }
            p.missingInfo = result.missingInfo || []
            p.references = result.references || []
            p.newSources = result._newSources || {}
            p.status = 'complete'
          }
          await saveProject(freshProject)
        }
      }

      try { res.write(`data: ${JSON.stringify({ done: true, successCount: Object.keys(results).length, errorCount: Object.keys(errors).length, failedPillarIds: Object.keys(errors) })}\n\n`) } catch { /* disconnected */ }
      res.end()
    } catch (err: any) {
      try { res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`) } catch { /* disconnected */ }
      res.end()
    }
  })

  // Sources batch — proxy to SiaGPT /medias/versions/sources/batch
  app.post('/api/ai/:projectId/sources/batch', requireSession, async (req: Request, res: Response) => {
    try {
      const { mediaVersionIds } = req.body
      if (!Array.isArray(mediaVersionIds) || mediaVersionIds.length === 0) return res.json([])
      if (!config.siagptBaseUrl) return res.json([])
      const token = await getSiaGptToken()
      const resp = await fetch(`${config.siagptBaseUrl}/medias/versions/sources/batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'app-origin': 'AI Platform' },
        body: JSON.stringify(mediaVersionIds),
      })
      if (!resp.ok) {
        const body = await resp.text()
        log.warn(`SiaGPT sources/batch failed: ${resp.status} ${body}`)
        return res.json([])
      }
      const data = await resp.json()
      res.json(data)
    } catch (err: any) {
      log.error('sources/batch error', err)
      res.status(500).json({ error: err.message })
    }
  })

  // Entity metadata batch — proxy to SiaGPT GET /medias/entities/{id}
  // Also enriches each result with summary + presigned path via sources/batch on the mediaVersionId
  app.post('/api/ai/:projectId/sources/entities-batch', requireSession, async (req: Request, res: Response) => {
    try {
      const { entityIds } = req.body
      if (!Array.isArray(entityIds) || entityIds.length === 0) return res.json([])
      if (!config.siagptBaseUrl) return res.json([])
      const token = await getSiaGptToken()

      // Step 1: fetch entity details (fileName, externalLink, mediaVersionId)
      const entityResults = await Promise.allSettled(
        entityIds.map(async (id: string) => {
          const r = await fetch(`${config.siagptBaseUrl}/medias/entities/${encodeURIComponent(id)}`, {
            headers: { Authorization: `Bearer ${token}`, 'app-origin': 'AI Platform' },
          })
          if (!r.ok) return null
          const d = await r.json() as Record<string, any>
          return {
            uuid: id,
            name: (d.fileName as string) || (d.name as string) || id,
            externalLink: (d.externalLink as string) || null,
            mediaVersionId: (d.mediaVersionId as string) || null,
          }
        })
      )
      const entities = entityResults
        .filter(r => r.status === 'fulfilled' && r.value)
        .map(r => (r as PromiseFulfilledResult<any>).value)

      // Step 2: batch-fetch media version metadata (summary + presigned path)
      const mvIds: string[] = Array.from(new Set(
        entities.map((e: any) => e.mediaVersionId).filter(Boolean)
      ))
      const versionMeta: Record<string, any> = {}
      if (mvIds.length > 0) {
        try {
          const mvResp = await fetch(`${config.siagptBaseUrl}/medias/versions/sources/batch`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'app-origin': 'AI Platform' },
            body: JSON.stringify(mvIds),
          })
          if (mvResp.ok) {
            const mvData = await mvResp.json() as any[]
            for (const v of mvData) { if (v?.uuid) versionMeta[v.uuid] = v }
          }
        } catch { /* non-fatal */ }
      }

      // Step 3: merge version metadata into entity results
      const merged = entities.map((e: any) => {
        const vm = e.mediaVersionId ? versionMeta[e.mediaVersionId] : null
        return {
          uuid: e.uuid,
          name: e.name,
          summary: vm?.summary || null,
          path: vm?.path || null,
          externalLink: e.externalLink || vm?.externalLink || null,
          mediaVersionId: e.mediaVersionId,
        }
      })
      res.json(merged)
    } catch (err: any) {
      log.error('sources/entities-batch error', err)
      res.status(500).json({ error: err.message })
    }
  })

  // Source proxy — streams the S3 document so the presigned URL is never exposed to the browser
  app.get('/api/ai/:projectId/sources/view/:mediaVersionId', requireSession, async (req: Request, res: Response) => {
    try {
      const { mediaVersionId } = req.params
      if (!config.siagptBaseUrl) return res.status(503).json({ error: 'Unavailable' })
      const token = await getSiaGptToken()
      const batchResp = await fetch(`${config.siagptBaseUrl}/medias/versions/sources/batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'app-origin': 'AI Platform' },
        body: JSON.stringify([mediaVersionId]),
      })
      if (!batchResp.ok) return res.status(502).json({ error: 'Failed to resolve source' })
      const batchData = await batchResp.json() as any[]
      const item = batchData.find((i: any) => i?.uuid === mediaVersionId) || batchData[0]
      if (item?.path) {
        const s3Resp = await fetch(item.path)
        if (!s3Resp.ok) return res.status(502).json({ error: 'Failed to fetch document' })
        const contentType = s3Resp.headers.get('content-type') || 'application/octet-stream'
        const contentLength = s3Resp.headers.get('content-length')
        const filename = item.name ? encodeURIComponent(item.name) : 'document'
        res.setHeader('Content-Type', contentType)
        res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${filename}`)
        if (contentLength) res.setHeader('Content-Length', contentLength)
        const { Readable } = await import('node:stream')
        Readable.fromWeb(s3Resp.body as any).pipe(res)
      } else if (item?.externalLink) {
        res.redirect(302, item.externalLink)
      } else {
        res.status(404).json({ error: 'Source not found' })
      }
    } catch (err: any) {
      log.error('sources/view error', err)
      res.status(500).json({ error: err.message })
    }
  })

  // Consolidate SWOT
  app.post('/api/ai/:projectId/consolidate-swot', requireSession, async (req: Request, res: Response) => {
    try {
      const project = await loadProject(req.params.projectId as string)
      if (!project) return res.status(404).json({ error: 'Not found' })

      let result: any

      {
        const pillarSWOTs = Object.entries(project.assessment.pillars).map(([id, p]: [string, any]) => ({
          pillar: `${id}: ${p.name}`, score: p.finalScore, swot: p.swot
        }))
        const prompt = `${buildSystemPrompt(project)}

Consolidate these pillar SWOTs into an entity-level SWOT for ${project.entityName}. Synthesize and de-duplicate. Rank by significance.

PILLAR SWOTs:
${JSON.stringify(pillarSWOTs, null, 2)}

Return ONLY this JSON:
{
  "consolidatedSwot": {
    "strengths": [{"text":"","sourcePillar":"P1","significance":"high|medium|low"}],
    "weaknesses": [{"text":"","sourcePillar":"P2","significance":"high|medium|low"}],
    "opportunities": [{"text":"","sourcePillar":"P3","significance":"high|medium|low"}],
    "threats": [{"text":"","sourcePillar":"P7","significance":"high|medium|low"}]
  },
  "strategicHypothesis": "<400-500 word synthesis>"
}`
        const { text: rawText } = await callSiaGPT(prompt, {
          assistantId: config.assistantIds.swot,
          tools: [],
          context: 'consolidate SWOT',
        })
        result = parseJsonFromText(rawText)
      }

      project.assessment.consolidatedSwot = result.consolidatedSwot
      project.assessment.strategicHypothesis = { aiDraft: result.strategicHypothesis, edited: result.strategicHypothesis }
      await saveProject(project)
      res.json({ success: true, data: result })
    } catch (err: any) { res.status(500).json({ error: err.message }) }
  })

  // Strategy Generation
  app.post('/api/ai/:projectId/strategy/generate', requireSession, async (req: Request, res: Response) => {
    try {
      const project = await loadProject(req.params.projectId as string)
      if (!project) return res.status(404).json({ error: 'Not found' })

      const { task, context } = req.body
      let data: any

      {
        // Resolve entity context — use subsidiary entity data when entityId is provided
        const entityId = context?.entityId
        const targetEntity = entityId ? (project.entities || []).find((e: any) => e.id === entityId) : null
        const assessmentData = targetEntity ? targetEntity.assessment : project.assessment
        const entityName = targetEntity ? targetEntity.name : project.entityName
        const entityType = targetEntity ? targetEntity.type : project.entityType
        const strategyData = targetEntity ? (targetEntity.strategy || project.strategy) : project.strategy

        const pillarSummaries = Object.entries(assessmentData.pillars)
          .map(([, p]: [string, any]) => `${p.name}: Score ${p.finalScore || 'N/A'} - ${p.execSummary?.edited?.substring(0, 150) || 'Not assessed'}`)
          .join('\n')

        const taskMap: Record<string, [string, string]> = {
          vision_mission: [`Generate Vision and Mission for ${entityName}.`, `{"vision":"<20-30 words>","mission":"<40-60 words>","rationale":"<explanation>"}`],
          strategic_objectives: [`Generate ${context?.count || 4} strategic objectives for ${entityName}.`, `{"objectives":[{"title":"","description":"","linkedPillars":["P1"],"rationale":"","priority":"high|medium"}]}`],
          kpis: [`Generate 4-6 KPIs for objective: "${context?.objectiveTitle}" for ${entityName}.`, `{"kpis":[{"indicator":"","baseline":"","target":"","targetYear":2030,"unit":"","owner":""}]}`],
          initiatives: [`Generate 3-5 initiatives for objective: "${context?.objectiveTitle}".`, `{"initiatives":[{"title":"","description":"","owner":"","startYear":2025,"endYear":2027,"priority":"high|medium|low"}]}`],
          projects: [`Generate 3-6 projects for initiative: "${context?.initiativeTitle}".`, `{"projects":[{"name":"","description":"","deliveryYear":2025,"owner":"","source":"Internal"}]}`],
          consistency_check: [`Review strategy for ${entityName}: ${JSON.stringify(strategyData)}`, `{"issues":[{"type":"gap|inconsistency","description":"","recommendation":""}],"overallAssessment":""}`]
        }
        const [taskPrompt, schema] = taskMap[task] || ['', '{}']
        const systemCtx = targetEntity
          ? `You are an expert strategy consultant at SIA Partners. Assess ${entityName} (${entityType}) using the 8-pillar framework.`
          : buildSystemPrompt(project)
        const prompt = `${systemCtx}\n\n${taskPrompt}\n\nContext:\n${pillarSummaries}\n\nReturn ONLY: ${schema}`
        const { text: rawText } = await callSiaGPT(prompt, {
          assistantId: config.assistantIds.strategy,
          tools: [],
          context: `strategy generate — ${task}${targetEntity ? ` (entity: ${entityName})` : ''}`,
        })
        data = parseJsonFromText(rawText)
      }

      res.json({ success: true, data })
    } catch (err: any) { res.status(500).json({ error: err.message }) }
  })

  // Chat — SSE streaming via SiaGPT with Claude
  app.post('/api/ai/:projectId/chat', requireSession, async (req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.flushHeaders()

    try {
      const project = await loadProject(req.params.projectId as string)
      if (!project) { res.write(`data: ${JSON.stringify({ error: 'Project not found' })}\n\n`); return res.end() }

      const { messages, context } = req.body
      const pillarId = context?.pillarId
      const pillar = pillarId ? project.assessment.pillars[pillarId] : null

      // Build a snapshot of ALL pillars for full assessment context
      const allPillarsSnapshot = Object.entries(project.assessment.pillars || {})
        .map(([pid, p]: [string, any]) => {
          const isCurrent = pid === pillarId
          const elements = (p.elements || [])
            .map((e: any) => `    • ${e.name} (score: ${e.aiScore ?? '?'}): ${(e.aiAnswer || '').substring(0, 150)}`)
            .join('\n')
          const swot = p.swot
            ? `    Strengths: ${(p.swot.strengths || []).join('; ') || 'none'}\n    Weaknesses: ${(p.swot.weaknesses || []).join('; ') || 'none'}\n    Opportunities: ${(p.swot.opportunities || []).join('; ') || 'none'}\n    Threats: ${(p.swot.threats || []).join('; ') || 'none'}`
            : '    SWOT: not yet assessed'
          return `${isCurrent ? '► ' : '  '}${pid}: ${p.name}  |  Score: ${p.finalScore ?? p.aiScore ?? 'not scored'}  |  Status: ${p.status || 'unknown'}${isCurrent ? '  ← CURRENT FOCUS' : ''}
  Summary: ${(p.execSummary?.edited || 'Not yet assessed').substring(0, 300)}
  Elements:
${elements || '    (no elements scored yet)'}
  SWOT:
${swot}`
        })
        .join('\n\n')

      const docContext = (project.documents || [])
        .map((d: any) => `=== ${d.name} ===\n${(d.extractedText || '').substring(0, 2000)}`)
        .join('\n\n')
        .substring(0, 8000) || 'No documents uploaded.'

      const persona = getAgentPersona(pillarId || '')

      const systemPrompt = `${persona}
You are assisting with the strategic assessment of ${project.entityName} (${project.entityType}).
Sector: ${project.sector || 'Not specified'}. Assessment period: ${project.assessmentDateStart || ''} – ${project.assessmentDateEnd || ''}.

━━━ FULL ASSESSMENT OVERVIEW — ALL PILLARS ━━━
${allPillarsSnapshot}

━━━ UPLOADED DOCUMENTS CONTEXT ━━━
${docContext}

INSTRUCTIONS:
- You have visibility of the ENTIRE assessment across all pillars — use this for cross-pillar insights
- Be specific, analytical, and evidence-based; reference actual content from documents when relevant
- Format responses using markdown: use **bold** for key terms, bullet lists for findings, ## headers for sections
- Challenge assumptions and provide rigorous, consulting-grade analysis
- When asked about a score, explain exactly what evidence or actions would justify improvement
- When asked cross-pillar questions (e.g. overall maturity, strategic coherence), draw on all pillar data
- Never be vague — be direct and substantive`

      const fullMessages = messages || [{ role: 'user', content: req.body.message || '' }]
      const lastUserMsg = fullMessages.filter((m: any) => m.role === 'user').pop()?.content || ''

      // Build conversation context as a single prompt for SiaGPT
      const conversationContext = fullMessages.slice(0, -1)
        .map((m: any) => `${m.role === 'assistant' ? 'Assistant' : 'User'}: ${m.content}`)
        .join('\n')
      const fullPrompt = systemPrompt + (conversationContext ? `\n\nConversation so far:\n${conversationContext}` : '') + `\n\nUser question: ${lastUserMsg}`
      const { text: aiText } = await callSiaGPT(fullPrompt, {
        assistantId: config.assistantIds.chat,
        collectionIds: project.siagptCollectionId ? [project.siagptCollectionId] : [],
        tools: ['rag', 'document_content', 'list_documents'],
        context: `chat — ${pillarId ? `pillar ${pillarId} (full assessment context)` : 'general (full assessment context)'}`,
      })
      // Stream the response in chunks for SSE compatibility
      const chunks = aiText.match(/[\s\S]{1,80}/g) || [aiText]
      for (const chunk of chunks) {
        res.write(`data: ${JSON.stringify({ chunk })}\n\n`)
        await new Promise(r => setTimeout(r, 15))
      }
      res.write(`data: ${JSON.stringify({ done: true })}\n\n`)
      res.end()
    } catch (err: any) {
      console.error('Chat error:', err)
      res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`)
      res.end()
    }
  })

  // Benchmark Generation
  app.post('/api/ai/:projectId/benchmarks/:pillarId', requireSession, async (req: Request, res: Response) => {
    try {
      const project = await loadProject(req.params.projectId as string)
      if (!project) return res.status(404).json({ error: 'Not found' })

      const pillarId = req.params.pillarId as string
      const entityId = req.body?.entityId as string | undefined

      // When entityId is provided, operate on that subsidiary entity's assessment
      let targetPillars: any
      let entityName: string
      let entityType: string
      if (entityId) {
        const entity = (project.entities || []).find((e: any) => e.id === entityId)
        if (!entity) return res.status(404).json({ error: 'Entity not found' })
        targetPillars = entity.assessment.pillars
        entityName = entity.name
        entityType = entity.type || project.entityType
      } else {
        targetPillars = project.assessment.pillars
        entityName = project.entityName
        entityType = project.entityType
      }

      const pillar = targetPillars[pillarId]
      if (!pillar) return res.status(404).json({ error: 'Pillar not found' })
      let benchmarkData: any

      {
        const prompt = `${getAgentPersona(pillarId)}Generate benchmark comparison data for the "${pillar.name}" pillar for ${entityName} (${entityType}). Current entity score: ${pillar.finalScore || 3.0}/5.

Provide 6-8 realistic benchmark comparators including GCC organizations, regional peers, and global best practice. Use your knowledge of GCC government entities, sovereign wealth funds, and comparable organizations.

Return ONLY valid JSON:
{
  "entityScore": ${pillar.finalScore || 3.0},
  "pillarName": "${pillar.name}",
  "benchmarks": [{"organization":"<name>","country":"<country>","flag":"<emoji>","score":<1.0-5.0>,"notes":"<insight>"}],
  "keyInsights": ["<2-3 insights on how entity compares>"],
  "improvementPriorities": ["<top 3 specific actions to close benchmark gap>"]
}`
        const { text: rawText } = await callSiaGPT(prompt, {
          assistantId: config.pillarAssistantIds[pillarId],
          tools: [],
          context: `benchmarks — pillar ${pillarId}`,
        })
        benchmarkData = parseJsonFromText(rawText)
      }

      targetPillars[pillarId].benchmarkData = benchmarkData
      await saveProject(project)
      res.json({ success: true, data: benchmarkData })
    } catch (err: any) { res.status(500).json({ error: err.message }) }
  })

  // ─── Helper: build report prompts for any entity context ───────────────────
  function buildReportPrompts(entityName: string, entityType: string, pillarsData: any, swotData: any): Record<string, string> {
    const mockProject = { entityName, entityType }
    const allPillars = Object.entries(pillarsData)
      .map(([, p]: [string, any]) => `## ${p.name} (${p.finalScore || 'N/A'}/5)\n${p.execSummary?.edited || 'Not assessed'}\nStrengths: ${(p.swot?.strengths || []).join(', ')}\nWeaknesses: ${(p.swot?.weaknesses || []).join(', ')}`)
      .join('\n\n')
    const allGaps = Object.entries(pillarsData)
      .map(([id, p]: [string, any]) => {
        const leadershipQs = Array.isArray(p.interviewQuestions) ? p.interviewQuestions : (p.interviewQuestions?.leadership || [])
        const teamQs = Array.isArray(p.interviewQuestions) ? [] : (p.interviewQuestions?.team || [])
        return `${id} ${p.name}: L: ${leadershipQs.slice(0,3).join(' | ')} | T: ${teamQs.slice(0,3).join(' | ')}`
      }).join('\n')
    return {
      D1: `${buildSystemPrompt(mockProject)}\n\nGenerate a 600-800 word Strategic Perception & Hypothesis Report for ${entityName} covering: 1) Executive Overview, 2) Strategic Tensions, 3) Cross-pillar Patterns, 4) Working Strategic Hypothesis, 5) Recommended Focus Areas.\n\nAssessment data:\n${allPillars}\n\nUse bullet points throughout. Format as structured markdown.`,
      D2: `${buildSystemPrompt(mockProject)}\n\nGenerate a full 1000-1500 word Strategic Diagnostic Report for ${entityName} covering all pillars, consolidated SWOT, and top 5 strategic priorities. Use bullet points throughout all sections.\n\nData:\n${allPillars}\n\nSwot: ${JSON.stringify(swotData)}\n\nFormat as structured markdown.`,
      D3: `${buildSystemPrompt(mockProject)}\n\nGenerate a Benchmark & Opportunity Map for ${entityName}. Include: 1) Cross-pillar score comparison table with RAG ratings, 2) Internal benchmarking observations, 3) External GCC and global benchmarks using your training knowledge, 4) A 2x2 Opportunity Prioritization Matrix (Impact x Feasibility) with all identified opportunities plotted.\n\nData:\n${allPillars}\n\nFormat as structured markdown with tables.`,
      D4: `${buildSystemPrompt(mockProject)}\n\nGenerate a 3-5 minute professional AI Video Script for ${entityName} covering: key findings, top 3 strengths and critical gaps, SWOT highlights, top 3 strategic imperatives, and a closing call-to-action. Format with [SCENE], [NARRATOR], and [VISUAL CUE] blocks.\n\nData:\n${allPillars}`,
      D5: `${buildSystemPrompt(mockProject)}\n\nGenerate Stakeholder Interview Guides for ${entityName}: 1) Leadership Set (10-15 strategic questions for C-suite/board), 2) Team Lead Set (10-15 operational questions for dept heads), 3) Gap-Filling Questions (one per data gap, tagged Pillar | Element | Priority).\n\nGaps:\n${allGaps}\n\nFormat as structured markdown.`,
      D6: `${buildSystemPrompt(mockProject)}\n\nGenerate a Full Strategy Document for ${entityName} following: Vision → Strategic Options → Outcomes → KPIs → Initiatives → Projects. Include executive summary, performance indicator tables, initiative roadmap, and strategic narrative.\n\nData:\n${allPillars}\n\nFormat as comprehensive structured markdown.`,
    }
  }

  // ─── Helper: strip AI appendix noise from report text ───────────────────────
  function cleanReportContent(raw: string): string {
    return raw
      .replace(/\n#{1,3}\s*(Appendix|appendix)[^\n]*\n[\s\S]*?```[\s\S]*?```[\s\S]*/g, '')
      .replace(/\n#{1,3}\s*(Appendix|appendix)[^\n]*\n[\s\S]*/g, '')
      .trimEnd()
  }

  // Report Generation — SSE streaming so long-running agents (80-120s) don't time out
  // Events: { heartbeat } | { progress, message } | { done, content } | { error }
  // Optional body param: { entityId } — if provided, generates from that entity's assessment
  app.post('/api/ai/:projectId/generate-report/:reportType', requireSession, async (req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.flushHeaders()

    const heartbeatInterval = setInterval(() => {
      try { res.write(': heartbeat\n\n') } catch { /* client disconnected */ }
    }, 15000)

    const sendEvent = (data: object) => {
      try { res.write(`data: ${JSON.stringify(data)}\n\n`) } catch { /* client disconnected */ }
    }

    try {
      const project = await loadProject(req.params.projectId as string)
      if (!project) {
        clearInterval(heartbeatInterval)
        sendEvent({ error: 'Project not found' })
        return res.end()
      }

      const reportType = req.params.reportType as string
      const entityId: string | undefined = req.body?.entityId

      // Resolve which entity's data to use
      let entityName: string
      let entityType: string
      let pillarsData: any
      let swotData: any
      let outputsStore: any // the object where outputs[reportType] will be written

      if (entityId && entityId !== '__main__') {
        const entity = (project.entities || []).find((e: any) => e.id === entityId)
        if (!entity) {
          clearInterval(heartbeatInterval)
          sendEvent({ error: 'Entity not found' })
          return res.end()
        }
        entityName = entity.name
        entityType = entity.type || project.entityType
        pillarsData = entity.assessment.pillars
        swotData = entity.assessment.consolidatedSwot
        if (!entity.outputs) entity.outputs = defaultOutputs()
        outputsStore = entity.outputs
      } else {
        entityName = project.entityName
        entityType = project.entityType
        pillarsData = project.assessment.pillars
        swotData = project.assessment.consolidatedSwot
        outputsStore = project.outputs
      }

      const prompts = buildReportPrompts(entityName, entityType, pillarsData, swotData)
      const prompt = prompts[reportType]
      if (!prompt) {
        clearInterval(heartbeatInterval)
        sendEvent({ error: 'Unknown report type' })
        return res.end()
      }

      sendEvent({ progress: true, message: `Generating ${reportType} report as markdown…` })
      const reportResult = await callSiaGPT(prompt, {
        assistantId: config.assistantIds[reportType.toLowerCase()],
        tools: [],
        context: `generate report ${reportType}`,
        timeoutMs: 12 * 60 * 1000,
      })

      const content = cleanReportContent(reportResult.text)
      outputsStore[reportType] = { generated: true, content, lastGenerated: new Date().toISOString() }
      await saveProject(project)
      clearInterval(heartbeatInterval)
      sendEvent({ done: true, content })
      return res.end()
    } catch (err: any) {
      clearInterval(heartbeatInterval)
      sendEvent({ error: err.message })
      res.end()
    }
  })

  // Batch Report Generation — runs multiple (entity × reportType) combinations in parallel
  // Body: { entityIds: string[], reportTypes: string[] }
  //   entityId '__main__' = main project entity; all others = subsidiary entity UUIDs
  // SSE events:
  //   { entityId, entityName, reportType, status: 'started' }
  //   { entityId, entityName, reportType, status: 'done', content }
  //   { entityId, entityName, reportType, status: 'error', error }
  //   { batchDone: true, total, succeeded, failed }
  app.post('/api/ai/:projectId/generate-reports-batch', requireSession, async (req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.flushHeaders()

    const heartbeatInterval = setInterval(() => {
      try { res.write(': heartbeat\n\n') } catch { /* client disconnected */ }
    }, 15000)

    const sendEvent = (data: object) => {
      try { res.write(`data: ${JSON.stringify(data)}\n\n`) } catch { /* client disconnected */ }
    }

    try {
      const project = await loadProject(req.params.projectId as string)
      if (!project) {
        clearInterval(heartbeatInterval)
        sendEvent({ error: 'Project not found' })
        return res.end()
      }

      const { entityIds, reportTypes } = req.body as { entityIds: string[], reportTypes: string[] }
      if (!Array.isArray(entityIds) || entityIds.length === 0 || !Array.isArray(reportTypes) || reportTypes.length === 0) {
        clearInterval(heartbeatInterval)
        sendEvent({ error: 'entityIds and reportTypes arrays are required' })
        return res.end()
      }

      const validReportTypes = ['D1','D2','D3','D4','D5','D6']
      const resolvedTypes = reportTypes.filter(t => validReportTypes.includes(t))

      // Build the list of tasks: { entityId, entityName, entityType, pillarsData, swotData, outputsStore }
      type Task = { entityId: string; entityName: string; entityType: string; pillarsData: any; swotData: any; outputsStore: any }
      const tasks: Task[] = []
      for (const eid of entityIds) {
        if (eid === '__main__') {
          tasks.push({
            entityId: '__main__',
            entityName: project.entityName,
            entityType: project.entityType,
            pillarsData: project.assessment.pillars,
            swotData: project.assessment.consolidatedSwot,
            outputsStore: project.outputs,
          })
        } else {
          const entity = (project.entities || []).find((e: any) => e.id === eid)
          if (!entity) continue
          if (!entity.outputs) entity.outputs = defaultOutputs()
          tasks.push({
            entityId: entity.id,
            entityName: entity.name,
            entityType: entity.type || project.entityType,
            pillarsData: entity.assessment.pillars,
            swotData: entity.assessment.consolidatedSwot,
            outputsStore: entity.outputs,
          })
        }
      }

      let succeeded = 0
      let failed = 0
      const total = tasks.length * resolvedTypes.length

      // Run all (entity × reportType) combinations in parallel
      const allJobs = tasks.flatMap(task =>
        resolvedTypes.map(reportType => async () => {
          sendEvent({ entityId: task.entityId, entityName: task.entityName, reportType, status: 'started' })
          try {
            const prompts = buildReportPrompts(task.entityName, task.entityType, task.pillarsData, task.swotData)
            const prompt = prompts[reportType]
            const result = await callSiaGPT(prompt, {
              assistantId: config.assistantIds[reportType.toLowerCase()],
              tools: [],
              context: `batch generate report ${reportType} for ${task.entityName}`,
              timeoutMs: 12 * 60 * 1000,
            })
            const content = cleanReportContent(result.text)
            task.outputsStore[reportType] = { generated: true, content, lastGenerated: new Date().toISOString() }
            succeeded++
            sendEvent({ entityId: task.entityId, entityName: task.entityName, reportType, status: 'done', content })
          } catch (err: any) {
            failed++
            sendEvent({ entityId: task.entityId, entityName: task.entityName, reportType, status: 'error', error: err.message })
          }
        })
      )

      await Promise.allSettled(allJobs.map(job => job()))

      // Persist all changes in one save
      await saveProject(project)
      clearInterval(heartbeatInterval)
      sendEvent({ batchDone: true, total, succeeded, failed })
      return res.end()
    } catch (err: any) {
      clearInterval(heartbeatInterval)
      sendEvent({ error: err.message })
      res.end()
    }
  })

  // Rubric endpoint — cached in server/data/rubric.json
  app.get('/api/rubric', requireSession, async (req: Request, res: Response) => {
    try {
      const rubricPath = path.join(process.cwd(), 'server', 'data', 'rubric.json')
      if (fs.existsSync(rubricPath)) {
        const cached = JSON.parse(fs.readFileSync(rubricPath, 'utf-8'))
        return res.json({ success: true, data: cached, cached: true })
      }
      res.json({ success: true, data: null, cached: false })
    } catch (err: any) { res.status(500).json({ error: err.message }) }
  })

  app.post('/api/rubric/generate', requireSession, async (req: Request, res: Response) => {
    try {
      const rubricPath = path.join(process.cwd(), 'server', 'data', 'rubric.json')
      let rubricData: any
      {
        const prompt = `You are a strategy assessment expert at SIA Partners. Generate a detailed scoring rubric table for all 8 strategic assessment pillars used in GCC entity assessments. For each pillar, for each element, describe in 2-3 bullet points what score band 1-2 (Critical), 2-3 (Weak), 3-3.5 (Developing), 3.5-4.5 (Strong), 4.5-5 (Excellent) looks like in practice for a government/corporate entity in GCC.

Pillars and elements:
P1 Strategic Identity & Vision: Mission & Vision Clarity, Strategic Intent, Value Proposition, Strategic Coherence, Parenting Purpose
P2 Governance & Leadership: Board Composition & Effectiveness, Leadership Team Capability, Decision-Making Architecture, Parenting Style, Accountability & Performance Management
P3 Financial Health: Revenue Trajectory, Profitability Analysis, Liquidity & Solvency, Cash Flow Quality, Capital Allocation Efficiency, Portfolio Financial Contribution
P4 Market Position: Market Size & Growth, Market Share & Positioning, Competitive Dynamics, Customer Concentration & Satisfaction, Competitive Advantage, Portfolio Synergies
P5 Operational Excellence: Core Competencies, Operational Efficiency, Technology & Digital Maturity, Supply Chain & Partnerships, Innovation Capability, Shared Services & Synergies
P6 Organization & People: Organizational Structure, Talent & Skills, Culture & Values, Employee Engagement, Change Readiness
P7 Risk & Resilience: Strategic Risks, Operational Risks, Financial Risks, Regulatory & Compliance, ESG & Sustainability
P8 Growth & Strategic Options: Organic Growth Vectors, Inorganic Growth, Digital & AI Opportunities, Blue Ocean Opportunities, Parenting Advantage Opportunities

Return ONLY valid JSON (no markdown, no explanation):
{
  "P1": {
    "Mission & Vision Clarity": {
      "critical": ["bullet1", "bullet2"],
      "weak": ["bullet1", "bullet2"],
      "developing": ["bullet1", "bullet2"],
      "strong": ["bullet1", "bullet2"],
      "excellent": ["bullet1", "bullet2"]
    }
  }
}
Include ALL 8 pillars and ALL elements listed above.`
        const { text: rawText } = await callSiaGPT(prompt, {
          assistantId: config.assistantIds.rubric,
          tools: [],
          context: 'generate rubric',
        })
        rubricData = parseJsonFromText(rawText)
      }
      const dir = path.dirname(rubricPath)
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(rubricPath, JSON.stringify(rubricData, null, 2))
      res.json({ success: true, data: rubricData })
    } catch (err: any) { res.status(500).json({ error: err.message }) }
  })

  // Export endpoints
  app.post('/api/export/:projectId/pdf/:reportType', requireSession, async (req: Request, res: Response) => {
    try {
      const project = await loadProject(req.params.projectId as string)
      if (!project) return res.status(404).json({ error: 'Not found' })
      const reportType = req.params.reportType as string
      const output = project.outputs[reportType]
      if (!output?.content) return res.status(400).json({ error: 'Report not generated yet. Generate the report first.' })
      const { generatePdf } = await import('./services/pdfExport.js')
      const pdfBuffer = await generatePdf(project, reportType, output.content)
      const filename = `${project.entityName.replace(/\s+/g,'_')}_${reportType}_${new Date().toISOString().split('T')[0]}.pdf`
      res.setHeader('Content-Type', 'application/pdf')
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
      res.send(pdfBuffer)
    } catch (err: any) { res.status(500).json({ error: err.message }) }
  })

  app.post('/api/export/:projectId/pptx/:reportType', requireSession, async (req: Request, res: Response) => {
    try {
      const project = await loadProject(req.params.projectId as string)
      if (!project) return res.status(404).json({ error: 'Not found' })
      const reportType = req.params.reportType as string
      const output = project.outputs[reportType]
      if (!output?.content) return res.status(400).json({ error: 'Report not generated yet. Generate the report first.' })
      const { generatePptx } = await import('./services/pptxExport.js')
      const pptxBuffer = await generatePptx(project, reportType, output.content)
      const filename = `${project.entityName.replace(/\s+/g,'_')}_${reportType}_${new Date().toISOString().split('T')[0]}.pptx`
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.presentationml.presentation')
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
      res.send(pptxBuffer)
    } catch (err: any) { res.status(500).json({ error: err.message }) }
  })

  // ====== ENTITY MANAGEMENT ROUTES ======

  // Add entity to project
  app.post('/api/projects/:id/entities', requireSession, async (req: Request, res: Response) => {
    try {
      const project = await loadProject(req.params.id as string)
      if (!project) return res.status(404).json({ error: 'Project not found' })
      const { name, type } = req.body
      if (!name) return res.status(400).json({ error: 'Entity name required' })
      const entity = createDefaultEntity(name, type || 'corporate')
      if (config.siagptMediaFolderId) {
        const collId = await createSiaGPTCollection(name, `SIA Partners strategy assessment collection for ${name}`)
        if (!collId) {
          return res.status(503).json({
            error: `Failed to create SiaGPT document collection for "${name}". Please retry — this is usually a temporary connectivity issue.`,
            retryable: true,
          })
        }
        entity.siagptCollectionId = collId
      }
      if (!project.entities) project.entities = []
      project.entities.push(entity)
      await saveProject(project)
      res.json({ success: true, entity: { id: entity.id, name: entity.name, type: entity.type, siagptCollectionId: entity.siagptCollectionId } })
    } catch (err: any) { res.status(500).json({ error: err.message }) }
  })

  // Remove entity from project
  app.delete('/api/projects/:id/entities/:entityId', requireSession, async (req: Request, res: Response) => {
    try {
      const project = await loadProject(req.params.id as string)
      if (!project) return res.status(404).json({ error: 'Project not found' })
      if (!project.entities) return res.status(404).json({ error: 'Entity not found' })
      project.entities = project.entities.filter((e: any) => e.id !== req.params.entityId)
      await saveProject(project)
      res.json({ success: true })
    } catch (err: any) { res.status(500).json({ error: err.message }) }
  })

  // Update entity metadata
  app.patch('/api/projects/:id/entities/:entityId', requireSession, async (req: Request, res: Response) => {
    try {
      const project = await loadProject(req.params.id as string)
      if (!project) return res.status(404).json({ error: 'Project not found' })
      const entity = (project.entities || []).find((e: any) => e.id === req.params.entityId)
      if (!entity) return res.status(404).json({ error: 'Entity not found' })
      const { name, type } = req.body
      if (name) entity.name = name
      if (type) entity.type = type
      await saveProject(project)
      res.json({ success: true })
    } catch (err: any) { res.status(500).json({ error: err.message }) }
  })

  // ====== ENTITY DOCUMENT ROUTES ======

  app.post('/api/documents/:projectId/:entityId/upload', requireSession, async (req: Request, res: Response) => {
    const multer = await import('multer')
    const storageConf = multer.default.diskStorage({
      destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
      filename: (_req, file, cb) => cb(null, `${uuidv4()}_${file.originalname}`)
    })
    const upload = multer.default({
      storage: storageConf,
      limits: { fileSize: 50 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        const allowed = ['application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.openxmlformats-officedocument.presentationml.presentation','application/msword','application/vnd.ms-excel','image/png','image/jpeg','image/jpg']
        allowed.includes(file.mimetype) ? cb(null, true) : cb(new Error(`File type ${file.mimetype} not supported`))
      }
    })
    upload.array('files', 20)(req as any, res as any, async (err: any) => {
      if (err) return res.status(400).json({ error: err.message })
      try {
        const project = await loadProject(req.params.projectId as string)
        if (!project) return res.status(404).json({ error: 'Project not found' })
        const entity = (project.entities || []).find((e: any) => e.id === req.params.entityId)
        if (!entity) return res.status(404).json({ error: 'Entity not found' })
        const { docType, docLabel } = req.body
        const files = (req as any).files as any[]
        // Verify the entity's SiaGPT collection is accessible by the current service account.
        // If the collection was created by a different user/token it will return 403 on upload.
        // Detect this upfront and recreate the collection so all files land in an owned collection.
        if (entity.siagptCollectionId && config.siagptBaseUrl) {
          const preToken = await getSiaGptToken().catch(() => null)
          if (preToken) {
            const verifyResp = await fetch(
              `${config.siagptBaseUrl}/medias/collections/${entity.siagptCollectionId}`,
              { headers: { Authorization: `Bearer ${preToken}`, 'app-origin': 'AI Platform' } }
            ).catch(() => null)
            if (verifyResp && (verifyResp.status === 403 || verifyResp.status === 404)) {
              log.warn(`Entity collection ${entity.siagptCollectionId} inaccessible (${verifyResp.status}) — recreating for "${entity.name}"`)
              const newCollId = await createSiaGPTCollection(
                entity.name, `SIA Partners strategy assessment collection for ${entity.name}`
              )
              entity.siagptCollectionId = newCollId ?? ''
            }
          }
        } else if (entity.siagptCollectionId) {
          await getSiaGptToken().catch(() => {})
        }
        const results = []
        for (const file of files) {
          const extractedText = await extractText(file.path, file.mimetype, file.originalname)
          const doc: any = { id: uuidv4(), name: file.originalname, type: docType || 'general', label: docLabel || file.originalname, mimetype: file.mimetype, size: file.size, extractedText, uploadedAt: new Date().toISOString(), wordCount: extractedText.split(/\s+/).filter(Boolean).length, siagptMediaId: '' }
          entity.documents.push(doc)
          if (entity.siagptCollectionId) {
            const mediaId = await uploadDocToSiaGPTCollection(file.path, file.originalname, file.mimetype, entity.siagptCollectionId)
            if (mediaId) doc.siagptMediaId = mediaId
          }
          try { fs.unlinkSync(file.path) } catch (e) {}
          results.push({ id: doc.id, name: doc.name, type: doc.type, wordCount: doc.wordCount, preview: extractedText.substring(0, 300), siagptMediaId: doc.siagptMediaId })
        }
        await saveProject(project)
        res.json({ success: true, documents: results })
      } catch (err: any) { res.status(500).json({ error: err.message }) }
    })
  })

  app.delete('/api/documents/:projectId/:entityId/:docId', requireSession, async (req: Request, res: Response) => {
    try {
      const project = await loadProject(req.params.projectId as string)
      if (!project) return res.status(404).json({ error: 'Project not found' })
      const entity = (project.entities || []).find((e: any) => e.id === req.params.entityId)
      if (!entity) return res.status(404).json({ error: 'Entity not found' })
      entity.documents = entity.documents.filter((d: any) => d.id !== req.params.docId)
      await saveProject(project)
      res.json({ success: true })
    } catch (err: any) { res.status(500).json({ error: err.message }) }
  })

  app.get('/api/documents/:projectId/:entityId/embedding-status', requireSession, async (req: Request, res: Response) => {
    try {
      const project = await loadProject(req.params.projectId as string)
      if (!project) return res.status(404).json({ error: 'Project not found' })
      const entity = (project.entities || []).find((e: any) => e.id === req.params.entityId)
      if (!entity) return res.status(404).json({ error: 'Entity not found' })
      if (!entity.siagptCollectionId) {
        const status: Record<string, number> = {}
        for (const doc of entity.documents) status[doc.name] = 1.0
        return res.json({ status })
      }
      const token = await getSiaGptToken()
      const resp = await fetch(`${config.siagptBaseUrl}/medias/collections/${entity.siagptCollectionId}?get_medias=true`, {
        headers: { Authorization: `Bearer ${token}`, 'app-origin': 'AI Platform' },
      })
      if (!resp.ok) return res.json({ status: {} })
      const data = await resp.json() as any
      const medias: any[] = data.medias || []
      const status: Record<string, number> = {}
      for (const media of medias) {
        if (media.name) status[media.name] = typeof media.completion === 'number' ? media.completion : 0
      }
      res.json({ status })
    } catch (err: any) { res.status(500).json({ error: err.message }) }
  })

  // ====== ENTITY ASSESSMENT ROUTES ======

  // Single pillar assessment for a specific entity
  app.post('/api/ai/:projectId/:entityId/assess/:pillarId', requireSession, async (req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    try {
      const project = await loadProject(req.params.projectId as string)
      if (!project) { res.write(`data: ${JSON.stringify({ error: 'Project not found' })}\n\n`); return res.end() }
      const entity = (project.entities || []).find((e: any) => e.id === req.params.entityId)
      if (!entity) { res.write(`data: ${JSON.stringify({ error: 'Entity not found' })}\n\n`); return res.end() }
      const pillarId = req.params.pillarId as string
      if (!entity.assessment.pillars[pillarId]) { res.write(`data: ${JSON.stringify({ error: 'Pillar not found' })}\n\n`); return res.end() }
      const entityProject = { entityName: entity.name, entityType: entity.type, assessment: entity.assessment }
      const collIds = entity.siagptCollectionId ? [entity.siagptCollectionId] : []
      const prompt = buildAssessmentPrompt(entityProject, pillarId)
      const { text: rawText, newSources } = await callSiaGPT(prompt, {
        assistantId: config.pillarAssistantIds[pillarId],
        collectionIds: collIds,
        context: `entity ${entity.name} pillar ${pillarId} assessment`,
      })
      for await (const _ of streamSiaGPTResponse(rawText, res, 50)) {}
      const parsed = parseJsonFromText(rawText)
      const result = parsed.pillarAssessment ?? parsed
      applyEntityPillarResult(entity, pillarId, result)
      entity.assessment.pillars[pillarId].newSources = newSources
      await saveProject(project)
      try { res.write(`data: ${JSON.stringify({ done: true, entityId: entity.id, pillarId, score: result.pillarScore })}\n\n`) } catch { /* disconnected */ }
      res.end()
    } catch (err: any) {
      try { res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`) } catch { /* disconnected */ }
      res.end()
    }
  })

  // Batch pillar assessment for a specific entity (all 8 pillars in parallel)
  app.post('/api/ai/:projectId/:entityId/assess-batch', requireSession, async (req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.flushHeaders()
    try {
      const project = await loadProject(req.params.projectId as string)
      if (!project) { res.write(`data: ${JSON.stringify({ error: 'Project not found' })}\n\n`); return res.end() }
      const entity = (project.entities || []).find((e: any) => e.id === req.params.entityId)
      if (!entity) { res.write(`data: ${JSON.stringify({ error: 'Entity not found' })}\n\n`); return res.end() }
      const reqPillarIds = req.body?.pillarIds
      const validIds: string[] = (Array.isArray(reqPillarIds) ? reqPillarIds : Object.keys(entity.assessment.pillars))
        .filter((id: string) => typeof id === 'string' && entity.assessment.pillars[id])
      if (validIds.length === 0) { res.write(`data: ${JSON.stringify({ error: 'No valid pillar IDs' })}\n\n`); return res.end() }
      const entityProject = { entityName: entity.name, entityType: entity.type, assessment: entity.assessment }
      const collIds = entity.siagptCollectionId ? [entity.siagptCollectionId] : []
      const results: Record<string, any> = {}
      const errors: Record<string, string> = {}
      log.info(`[entity-batch-assess] ${entity.name}: ${validIds.length} pillars in parallel`)
      await Promise.allSettled(
        validIds.map(async (pillarId: string) => {
          let lastError: Error | undefined
          for (let attempt = 0; attempt <= MAX_ASSESSMENT_RETRIES; attempt++) {
            try {
              if (attempt > 0) {
                log.info(`[entity-batch-assess] RETRY ${attempt}/${MAX_ASSESSMENT_RETRIES} for ${entity.name} pillar ${pillarId}`)
                try { res.write(`data: ${JSON.stringify({ entityId: entity.id, pillarId, retrying: true, attempt })}\n\n`) } catch { /* disconnected */ }
              }
              const prompt = buildAssessmentPrompt(entityProject, pillarId)
              const { text: rawText, newSources } = await callSiaGPT(prompt, {
                assistantId: config.pillarAssistantIds[pillarId],
                collectionIds: collIds,
                context: `entity ${entity.name} pillar ${pillarId} batch (attempt ${attempt + 1})`,
              })
              const parsed = parseJsonFromText(rawText)
              results[pillarId] = { ...(parsed.pillarAssessment ?? parsed), _newSources: newSources }
              try { res.write(`data: ${JSON.stringify({ entityId: entity.id, pillarId, progress: true, score: results[pillarId].pillarScore })}\n\n`) } catch { /* disconnected */ }
              return // success
            } catch (err: any) {
              lastError = err
              log.info(`[entity-batch-assess] ERROR ${entity.name} pillar ${pillarId} (attempt ${attempt + 1}) — ${err.message}`)
            }
          }
          // All retries exhausted
          errors[pillarId] = lastError!.message
          try { res.write(`data: ${JSON.stringify({ entityId: entity.id, pillarId, error: lastError!.message })}\n\n`) } catch { /* disconnected */ }
        })
      )
      if (Object.keys(results).length > 0) {
        const fresh = await loadProject(req.params.projectId as string)
        if (fresh) {
          const freshEntity = (fresh.entities || []).find((e: any) => e.id === req.params.entityId)
          if (freshEntity) {
            for (const [pid, result] of Object.entries(results)) {
              applyEntityPillarResult(freshEntity, pid, result)
              freshEntity.assessment.pillars[pid].newSources = result._newSources || {}
            }
            await saveProject(fresh)
          }
        }
      }
      try { res.write(`data: ${JSON.stringify({ done: true, entityId: entity.id, failedPillarIds: Object.keys(errors) })}\n\n`) } catch { /* disconnected */ }
      res.end()
    } catch (err: any) {
      try { res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`) } catch { /* disconnected */ }
      res.end()
    }
  })

  // Run all pillars for multiple entities in parallel (the main scale endpoint)
  app.post('/api/ai/:projectId/assess-entities', requireSession, async (req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.flushHeaders()
    try {
      const project = await loadProject(req.params.projectId as string)
      if (!project) { res.write(`data: ${JSON.stringify({ error: 'Project not found' })}\n\n`); return res.end() }
      const { entityIds }: { entityIds?: string[] } = req.body
      const allEntities: any[] = project.entities || []
      const targetEntities = entityIds?.length
        ? allEntities.filter((e: any) => entityIds.includes(e.id))
        : allEntities
      if (targetEntities.length === 0) { res.write(`data: ${JSON.stringify({ error: 'No entities found' })}\n\n`); return res.end() }
      const pillarIds = ['P1','P2','P3','P4','P5','P6','P7','P8']
      const allResults: Record<string, Record<string, any>> = {}
      log.info(`[assess-entities] ${targetEntities.length} entities × 8 pillars = ${targetEntities.length * 8} parallel calls`)
      await Promise.allSettled(
        targetEntities.flatMap((entity: any) =>
          pillarIds.map(async (pillarId: string) => {
            if (!entity.assessment?.pillars?.[pillarId]) return
            try {
              const entityProject = { entityName: entity.name, entityType: entity.type, assessment: entity.assessment }
              const collIds = entity.siagptCollectionId ? [entity.siagptCollectionId] : []
              const prompt = buildAssessmentPrompt(entityProject, pillarId)
              const { text: rawText } = await callSiaGPT(prompt, {
                assistantId: config.pillarAssistantIds[pillarId],
                collectionIds: collIds,
                context: `multi-entity: ${entity.name} P${pillarId.slice(1)}`,
              })
              const parsed = parseJsonFromText(rawText)
              const result = parsed.pillarAssessment ?? parsed
              if (!allResults[entity.id]) allResults[entity.id] = {}
              allResults[entity.id][pillarId] = result
              res.write(`data: ${JSON.stringify({ entityId: entity.id, entityName: entity.name, pillarId, progress: true, score: result.pillarScore })}\n\n`)
            } catch (err: any) {
              res.write(`data: ${JSON.stringify({ entityId: entity.id, entityName: entity.name, pillarId, error: err.message })}\n\n`)
            }
          })
        )
      )
      if (Object.keys(allResults).length > 0) {
        const fresh = await loadProject(req.params.projectId as string)
        if (fresh) {
          for (const [entityId, pillarResults] of Object.entries(allResults)) {
            const freshEntity = (fresh.entities || []).find((e: any) => e.id === entityId)
            if (!freshEntity) continue
            for (const [pid, result] of Object.entries(pillarResults)) applyEntityPillarResult(freshEntity, pid, result)
          }
          await saveProject(fresh)
        }
      }
      res.write(`data: ${JSON.stringify({ done: true, entityCount: targetEntities.length, completedCount: Object.keys(allResults).length })}\n\n`)
      res.end()
    } catch (err: any) {
      res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`)
      res.end()
    }
  })

  // SiaGPT integration: OpenAPI spec + plugin manifest
  registerSiaGptRoutes(app)

  // SiaGPT webhook receiver
  app.use('/webhooks', webhooksRouter)
}

async function extractText(filePath: string, mimetype: string, originalName: string): Promise<string> {
  try {
    const ext = path.extname(originalName).toLowerCase()
    if (mimetype === 'application/pdf' || ext === '.pdf') {
      const { PDFParse } = _require('pdf-parse')
      const parser = new PDFParse({ url: filePath })
      const result = await parser.getText()
      return result.text || ''
    }
    if (mimetype.includes('wordprocessingml') || ext === '.docx' || ext === '.doc') {
      const mammoth = _require('mammoth')
      const m = mammoth.default || mammoth
      const result = await m.extractRawText({ path: filePath })
      return result.value || ''
    }
    if (mimetype.includes('spreadsheetml') || ext === '.xlsx' || ext === '.xls') {
      const xlsxLib = _require('xlsx')
      const XLSX = xlsxLib.default || xlsxLib
      const workbook = XLSX.readFile(filePath)
      let text = ''
      workbook.SheetNames.forEach((sheetName: string) => {
        const sheet = workbook.Sheets[sheetName]
        text += `\n=== Sheet: ${sheetName} ===\n`
        text += XLSX.utils.sheet_to_csv(sheet)
      })
      return text
    }
    if (mimetype.includes('presentationml') || ext === '.pptx') {
      return `[PPTX file: ${originalName}]`
    }
    if (mimetype.includes('image')) {
      return `[Image file: ${originalName}]`
    }
    return ''
  } catch (err: any) {
    console.error('Text extraction error:', err.message)
    return `[Extraction failed: ${err.message}]`
  }
}
