import type { Express, Request, Response, NextFunction } from 'express'
import express from 'express'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'
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

const UPLOADS_DIR = path.join(__dirname, 'uploads')

if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true })

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
    outputs: {
      D1: { generated: false, content: '', lastGenerated: null },
      D2: { generated: false, content: '', lastGenerated: null },
      D3: { generated: false, content: '', lastGenerated: null },
      D4: { generated: false, content: '', lastGenerated: null },
      D5: { generated: false, content: '', lastGenerated: null },
      D6: { generated: false, content: '', lastGenerated: null },
    }
  }
}

const SCORING_RUBRIC = `Score 1 (Critical/Absent): Element is absent or severely underdeveloped.
Score 2 (Weak/Early Stage): Element exists but is ad-hoc and inconsistent.
Score 3 (Developing/Adequate): Functional, meets basic requirements.
Score 4 (Strong/Advanced): Well-developed, consistent, above average for sector.
Score 5 (Excellent/Best-in-Class): Sector-leading practice.`

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

SCORING RUBRIC:
${SCORING_RUBRIC}

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

  // Use static bearer token if configured (dev/testing shortcut)
  if (config.siagptBearerToken) {
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

async function createSiaGPTCollection(name: string, description: string): Promise<string | null> {
  if (!config.siagptMediaFolderId) return null
  try {
    const token = await getSiaGptToken()
    log.collectionRequest(name, description, config.siagptMediaFolderId)
    const resp = await fetch(`${config.siagptBaseUrl}/medias/collections`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'app-origin': 'AI Platform' },
      body: JSON.stringify({ name, description, folderId: config.siagptMediaFolderId }),
    })
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
  try {
    const token = await getSiaGptToken()
    log.docUploadRequest(fileName, mimetype, collectionId)
    const fileBuffer = fs.readFileSync(filePath)
    const blob = new Blob([fileBuffer], { type: mimetype })
    const formData = new FormData()
    formData.append('file', blob, fileName)
    formData.append('media_metadata', JSON.stringify({ collectionId }))
    const resp = await fetch(`${config.siagptBaseUrl}/medias/`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'app-origin': 'AI Platform', Accept: 'application/json' },
      body: formData,
    })
    if (!resp.ok) {
      const body = await resp.text()
      log.warn(`SiaGPT media upload failed: ${resp.status} ${body}`)
      log.docUploadResponse(fileName, false, resp.status)
      return null
    } else {
      const data = await resp.json() as any
      log.docUploadResponse(fileName, true)
      return data.uuid || null
    }
  } catch (e: any) {
    log.error('SiaGPT media upload error', e)
    log.docUploadResponse(fileName, false)
    return null
  }
}

async function callSiaGPT(
  prompt: string,
  options?: {
    assistantId?: string
    collectionIds?: string[]
    tools?: string[]
    context?: string   // human-readable label shown in logs, e.g. "pillar P1 assessment"
  }
): Promise<string> {
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
  const msgResp = await fetch(`${baseUrl}/chat/messages/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'app-origin': 'AI Platform' },
    body: JSON.stringify(msgPayload),
  })
  if (!msgResp.ok) {
    if (msgResp.status === 401) _cachedSiaGptToken = undefined
    const errBody = await msgResp.text()
    log.messageError(`${msgResp.status}: ${errBody}`, ctx)
    throw new Error(`SiaGPT message failed: ${msgResp.status}`)
  }

  const raw = await msgResp.text()
  // Parse NDJSON or single JSON — prefer OVERWRITE_TEXT then CHAT event
  let chosenEvent = 'raw'
  let result: string
  try {
    const parsed = JSON.parse(raw)
    const events: any[] = Array.isArray(parsed) ? parsed : [parsed]
    const errorEvent = events.find(e => e.event === 'NEW_ERROR')
    if (errorEvent) throw new Error(`SiaGPT error: ${errorEvent.error ?? JSON.stringify(errorEvent)}`)
    const chosen = events.find(e => e.event === 'OVERWRITE_TEXT') ??
      events.find(e => e.event === 'CHAT') ??
      events[events.length - 1]
    chosenEvent = chosen?.event ?? 'json'
    result = String(chosen?.data ?? chosen?.content ?? raw)
  } catch (e: any) {
    if (e.message?.startsWith('SiaGPT error:')) throw e
    const events = raw.split('\n').filter(l => l.trim()).map(l => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
    if (events.length > 0) {
      const errorEvent = (events as any[]).find(e => e.event === 'NEW_ERROR')
      if (errorEvent) throw new Error(`SiaGPT error: ${errorEvent.error ?? JSON.stringify(errorEvent)}`)
      const chosen = (events as any[]).find(e => e.event === 'OVERWRITE_TEXT') ??
        (events as any[]).find(e => e.event === 'CHAT') ??
        events[events.length - 1]
      chosenEvent = (chosen as any)?.event ?? 'ndjson'
      result = String((chosen as any)?.data ?? (chosen as any)?.content ?? raw)
    } else {
      result = raw
    }
  }
  log.messageResponse(result, chosenEvent, ctx)
  return result
}

async function* streamSiaGPTResponse(text: string, res: Response, chunkSize = 50) {
  for (let i = 0; i < text.length; i += chunkSize) {
    const chunk = text.slice(i, i + chunkSize)
    res.write(`data: ${JSON.stringify({ chunk })}\n\n`)
    await new Promise(r => setTimeout(r, 20))
  }
}

function parseJsonFromText(text: string): any {
  let cleaned = text
    .replace(/```json\n?/gi, '')
    .replace(/```\n?/gi, '')
    .trim()
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start === -1 || end === -1) throw new Error('No JSON object found in SiaGPT response')
  return JSON.parse(cleaned.slice(start, end + 1))
}

// ====== ROUTE REGISTRATION ======
export function registerRoutes(httpServer: any, app: Express) {
  app.use(express.json({ limit: '10mb' }))

  // Config endpoint
  app.get('/api/config', (_req: Request, res: Response) => {
    res.json({ provider: 'siagpt-claude' })
  })

  // ====== PROJECT ROUTES ======
  app.post('/api/projects', async (req: Request, res: Response) => {
    try {
      const bcrypt = await import('bcryptjs')
      const { name, entityName, entityType, password, consultantName } = req.body
      if (!name || !entityName || !password) return res.status(400).json({ error: 'name, entityName, and password are required' })
      const project = createDefaultProject(name, entityName, entityType)
      project.passwordHash = await bcrypt.default.hash(password, 12)
      project.consultantName = consultantName || ''
      if (config.siagptMediaFolderId) {
        const collId = await createSiaGPTCollection(
          entityName,
          `SIA Partners strategy assessment collection for ${entityName}`
        )
        if (collId) project.siagptCollectionId = collId
      }
      await saveProject(project)
      log.projectCreate(name, entityName, project.id)
      const session = (req as any).session
      if (!session.unlockedProjects) session.unlockedProjects = []
      session.unlockedProjects.push(project.id)
      res.json({ id: project.id, name: project.name, entityName: project.entityName })
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
      res.json({ success: true, id: project.id, name: project.name, entityName: project.entityName })
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

  app.patch('/api/projects/:id/strategy', requireSession, async (req: Request, res: Response) => {
    try {
      const project = await loadProject(req.params.id as string)
      if (!project) return res.status(404).json({ error: 'Not found' })
      project.strategy = { ...project.strategy, ...req.body }
      await saveProject(project)
      res.json({ success: true })
    } catch (err: any) { res.status(500).json({ error: err.message }) }
  })

  app.delete('/api/projects/:id', requireSession, async (req: Request, res: Response) => {
    try {
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

      {
        const collIds = project.siagptCollectionId ? [project.siagptCollectionId] : []
        const prompt = buildAssessmentPrompt(project, pillarId)
        const rawText = await callSiaGPT(prompt, {
          assistantId: config.pillarAssistantIds[pillarId],
          collectionIds: collIds,
          context: `pillar ${pillarId} assessment — ${pillar.name}`,
        })
        for await (const _ of streamSiaGPTResponse(rawText, res, 50)) {}
        const parsed = parseJsonFromText(rawText)
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
      p.status = 'complete'
      await saveProject(project)

      res.write(`data: ${JSON.stringify({ done: true, pillarId, score: result.pillarScore })}\n\n`)
      res.end()
    } catch (err: any) {
      res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`)
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

      // Run all SiaGPT calls in parallel — all start simultaneously
      await Promise.allSettled(
        validIds.map(async (pillarId: string) => {
          const t0 = Date.now()
          log.info(`[batch-assess] START pillar ${pillarId} — t=${t0}`)
          try {
            const prompt = buildAssessmentPrompt(project, pillarId)
            const rawText = await callSiaGPT(prompt, {
              assistantId: config.pillarAssistantIds[pillarId],
              collectionIds: collIds,
              context: `pillar ${pillarId} assessment (batch) — ${project.assessment.pillars[pillarId].name}`,
            })
            const parsed = parseJsonFromText(rawText)
            results[pillarId] = parsed.pillarAssessment ?? parsed
            log.info(`[batch-assess] DONE pillar ${pillarId} — ${Date.now() - t0}ms`)
            res.write(`data: ${JSON.stringify({ pillarId, progress: true, score: results[pillarId].pillarScore })}\n\n`)
          } catch (err: any) {
            errors[pillarId] = err.message
            log.info(`[batch-assess] ERROR pillar ${pillarId} — ${err.message}`)
            res.write(`data: ${JSON.stringify({ pillarId, error: err.message })}\n\n`)
          }
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
            p.status = 'complete'
          }
          await saveProject(freshProject)
        }
      }

      res.write(`data: ${JSON.stringify({ done: true, successCount: Object.keys(results).length, errorCount: Object.keys(errors).length })}\n\n`)
      res.end()
    } catch (err: any) {
      res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`)
      res.end()
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
        const rawText = await callSiaGPT(prompt, {
          collectionIds: project.siagptCollectionId ? [project.siagptCollectionId] : [],
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
        const pillarSummaries = Object.entries(project.assessment.pillars)
          .map(([, p]: [string, any]) => `${p.name}: Score ${p.finalScore || 'N/A'} - ${p.execSummary?.edited?.substring(0, 150) || 'Not assessed'}`)
          .join('\n')

        const taskMap: Record<string, [string, string]> = {
          vision_mission: [`Generate Vision and Mission for ${project.entityName}.`, `{"vision":"<20-30 words>","mission":"<40-60 words>","rationale":"<explanation>"}`],
          strategic_objectives: [`Generate ${context?.count || 4} strategic objectives for ${project.entityName}.`, `{"objectives":[{"title":"","description":"","linkedPillars":["P1"],"rationale":"","priority":"high|medium"}]}`],
          kpis: [`Generate 4-6 KPIs for objective: "${context?.objectiveTitle}" for ${project.entityName}.`, `{"kpis":[{"indicator":"","baseline":"","target":"","targetYear":2030,"unit":"","owner":""}]}`],
          initiatives: [`Generate 3-5 initiatives for objective: "${context?.objectiveTitle}".`, `{"initiatives":[{"title":"","description":"","owner":"","startYear":2025,"endYear":2027,"priority":"high|medium|low"}]}`],
          projects: [`Generate 3-6 projects for initiative: "${context?.initiativeTitle}".`, `{"projects":[{"name":"","description":"","deliveryYear":2025,"owner":"","source":"Internal"}]}`],
          consistency_check: [`Review strategy for ${project.entityName}: ${JSON.stringify(project.strategy)}`, `{"issues":[{"type":"gap|inconsistency","description":"","recommendation":""}],"overallAssessment":""}`]
        }
        const [taskPrompt, schema] = taskMap[task] || ['', '{}']
        const prompt = `${buildSystemPrompt(project)}\n\n${taskPrompt}\n\nContext:\n${pillarSummaries}\n\nReturn ONLY: ${schema}`
        const rawText = await callSiaGPT(prompt, {
          collectionIds: project.siagptCollectionId ? [project.siagptCollectionId] : [],
          context: `strategy generate — ${task}`,
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

      const pillarContext = pillar ? `
CURRENT PILLAR: ${pillar.name}
CURRENT SCORE: ${pillar.finalScore || 'Not yet scored'}
EXECUTIVE SUMMARY: ${pillar.execSummary?.edited || 'Not yet assessed'}
KEY FINDINGS: ${JSON.stringify((pillar.elements || []).map((e: any) => ({ name: e.name, score: e.aiScore, answer: e.aiAnswer?.substring(0, 200) })))}
SWOT: ${JSON.stringify(pillar.swot)}` : ''

      const docContext = (project.documents || [])
        .map((d: any) => `=== ${d.name} ===\n${(d.extractedText || '').substring(0, 2000)}`)
        .join('\n\n')
        .substring(0, 8000) || 'No documents uploaded.'

      const persona = getAgentPersona(pillarId || '')

      const systemPrompt = `${persona}
You are assisting with the strategic assessment of ${project.entityName} (${project.entityType}).
${pillarContext}

UPLOADED DOCUMENTS CONTEXT:
${docContext}

INSTRUCTIONS:
- Be specific, analytical, and evidence-based
- Reference actual content from the documents when possible
- Format responses as clear bullet points
- Challenge assumptions and provide rigorous analysis
- If asked to improve a score, explain exactly what evidence or actions would justify a higher score
- Never be vague — be direct and consulting-grade in quality`

      const fullMessages = messages || [{ role: 'user', content: req.body.message || '' }]
      const lastUserMsg = fullMessages.filter((m: any) => m.role === 'user').pop()?.content || ''

      // Build conversation context as a single prompt for SiaGPT
      const conversationContext = fullMessages.slice(0, -1)
        .map((m: any) => `${m.role === 'assistant' ? 'Assistant' : 'User'}: ${m.content}`)
        .join('\n')
      const fullPrompt = systemPrompt + (conversationContext ? `\n\nConversation so far:\n${conversationContext}` : '') + `\n\nUser question: ${lastUserMsg}`
      const aiText = await callSiaGPT(fullPrompt, {
        collectionIds: project.siagptCollectionId ? [project.siagptCollectionId] : [],
        context: `chat — ${pillarId ? `pillar ${pillarId}` : 'general'}`,
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
      const pillar = project.assessment.pillars[pillarId]
      let benchmarkData: any

      {
        const prompt = `${getAgentPersona(pillarId)}Generate benchmark comparison data for the "${pillar.name}" pillar for ${project.entityName} (${project.entityType}). Current entity score: ${pillar.finalScore || 3.0}/5.

Provide 6-8 realistic benchmark comparators including GCC organizations, regional peers, and global best practice. Use your knowledge of GCC government entities, sovereign wealth funds, and comparable organizations.

Return ONLY valid JSON:
{
  "entityScore": ${pillar.finalScore || 3.0},
  "pillarName": "${pillar.name}",
  "benchmarks": [{"organization":"<name>","country":"<country>","flag":"<emoji>","score":<1.0-5.0>,"notes":"<insight>"}],
  "keyInsights": ["<2-3 insights on how entity compares>"],
  "improvementPriorities": ["<top 3 specific actions to close benchmark gap>"]
}`
        const rawText = await callSiaGPT(prompt, {
          assistantId: config.pillarAssistantIds[pillarId],
          collectionIds: project.siagptCollectionId ? [project.siagptCollectionId] : [],
          context: `benchmarks — pillar ${pillarId}`,
        })
        benchmarkData = parseJsonFromText(rawText)
      }

      project.assessment.pillars[pillarId].benchmarkData = benchmarkData
      await saveProject(project)
      res.json({ success: true, data: benchmarkData })
    } catch (err: any) { res.status(500).json({ error: err.message }) }
  })

  // Report Generation
  app.post('/api/ai/:projectId/generate-report/:reportType', requireSession, async (req: Request, res: Response) => {
    try {
      const project = await loadProject(req.params.projectId as string)
      if (!project) return res.status(404).json({ error: 'Not found' })

      const reportType = req.params.reportType as string
      let content: string

      {
        const allPillars = Object.entries(project.assessment.pillars)
          .map(([, p]: [string, any]) => `## ${p.name} (${p.finalScore || 'N/A'}/5)\n${p.execSummary?.edited || 'Not assessed'}\nStrengths: ${(p.swot?.strengths || []).join(', ')}\nWeaknesses: ${(p.swot?.weaknesses || []).join(', ')}`)
          .join('\n\n')

        const allGaps = Object.entries(project.assessment.pillars)
          .map(([id, p]: [string, any]) => {
            const leadershipQs = Array.isArray(p.interviewQuestions) ? p.interviewQuestions : (p.interviewQuestions?.leadership || [])
            const teamQs = Array.isArray(p.interviewQuestions) ? [] : (p.interviewQuestions?.team || [])
            return `${id} ${p.name}: L: ${leadershipQs.slice(0,3).join(' | ')} | T: ${teamQs.slice(0,3).join(' | ')}`
          }).join('\n')

        const prompts: Record<string, string> = {
          D1: `${buildSystemPrompt(project)}\n\nGenerate a 600-800 word Strategic Perception & Hypothesis Report for ${project.entityName} covering: 1) Executive Overview, 2) Strategic Tensions, 3) Cross-pillar Patterns, 4) Working Strategic Hypothesis, 5) Recommended Focus Areas.\n\nAssessment data:\n${allPillars}\n\nUse bullet points throughout. Format as structured markdown.`,
          D2: `${buildSystemPrompt(project)}\n\nGenerate a full 1000-1500 word Strategic Diagnostic Report for ${project.entityName} covering all pillars, consolidated SWOT, and top 5 strategic priorities. Use bullet points throughout all sections.\n\nData:\n${allPillars}\n\nSwot: ${JSON.stringify(project.assessment.consolidatedSwot)}\n\nFormat as structured markdown.`,
          D3: `${buildSystemPrompt(project)}\n\nGenerate a Benchmark & Opportunity Map for ${project.entityName}. Include: 1) Cross-pillar score comparison table with RAG ratings, 2) Internal benchmarking observations, 3) External GCC and global benchmarks using your training knowledge, 4) A 2x2 Opportunity Prioritization Matrix (Impact x Feasibility) with all identified opportunities plotted.\n\nData:\n${allPillars}\n\nFormat as structured markdown with tables.`,
          D4: `${buildSystemPrompt(project)}\n\nGenerate a 3-5 minute professional AI Video Script for ${project.entityName} covering: key findings, top 3 strengths and critical gaps, SWOT highlights, top 3 strategic imperatives, and a closing call-to-action. Format with [SCENE], [NARRATOR], and [VISUAL CUE] blocks.\n\nData:\n${allPillars}`,
          D5: `${buildSystemPrompt(project)}\n\nGenerate Stakeholder Interview Guides for ${project.entityName}: 1) Leadership Set (10-15 strategic questions for C-suite/board), 2) Team Lead Set (10-15 operational questions for dept heads), 3) Gap-Filling Questions (one per data gap, tagged Pillar | Element | Priority).\n\nGaps:\n${allGaps}\n\nFormat as structured markdown.`,
          D6: `${buildSystemPrompt(project)}\n\nGenerate a Full Strategy Document for ${project.entityName} following: Vision → Strategic Options → Outcomes → KPIs → Initiatives → Projects. Include executive summary, performance indicator tables, initiative roadmap, and strategic narrative.\n\nData:\n${allPillars}\n\nFormat as comprehensive structured markdown.`
        }
        const prompt = prompts[(reportType as string)]
        if (!prompt) return res.status(400).json({ error: 'Unknown report type' })
        content = await callSiaGPT(prompt, {
          collectionIds: project.siagptCollectionId ? [project.siagptCollectionId] : [],
          context: `generate report ${reportType}`,
        })
      }

      project.outputs[reportType] = { generated: true, content, lastGenerated: new Date().toISOString() }
      await saveProject(project)
      res.json({ success: true, content })
    } catch (err: any) { res.status(500).json({ error: err.message }) }
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
        const rawText = await callSiaGPT(prompt, { context: 'generate rubric' })
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
