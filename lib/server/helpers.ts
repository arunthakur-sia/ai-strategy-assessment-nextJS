import 'server-only'
import { v4 as uuidv4 } from 'uuid'
import { supabase } from './db'

export function createPillar(id: string, name: string, description: string, elementNames: string[]) {
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

export function createDefaultEntityAssessment() {
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

export function defaultOutputs() {
  return {
    D1: { generated: false, content: '', lastGenerated: null },
    D2: { generated: false, content: '', lastGenerated: null },
    D3: { generated: false, content: '', lastGenerated: null },
    D4: { generated: false, content: '', lastGenerated: null },
    D5: { generated: false, content: '', lastGenerated: null },
    D6: { generated: false, content: '', lastGenerated: null },
  }
}

export function createDefaultEntity(name: string, type: string) {
  return {
    id: uuidv4(), name, type: type || 'corporate',
    siagptCollectionId: '',
    documents: [],
    assessment: createDefaultEntityAssessment(),
    outputs: defaultOutputs(),
    strategy: { template: 'government', levelNames: ['Vision', 'Strategic Option', 'Outcome', 'Initiative'], nodes: [] }
  }
}

export function createDefaultProject(name: string, entityName: string, entityType: string) {
  return {
    id: uuidv4(), name, entityName,
    entityType: entityType || 'government',
    language: 'en',
    interviewModeEnabled: false,
    consultantName: '',
    passwordHash: '' as string,
    assessmentDateStart: '', assessmentDateEnd: '',
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    documents: [],
    siagptCollectionId: '',
    entities: [] as any[],
    assessment: createDefaultEntityAssessment(),
    strategy: { template: 'government', levelNames: ['Vision','Strategic Option','Outcome','Initiative'], nodes: [] },
    outputs: defaultOutputs()
  }
}

export function applyEntityPillarResult(entity: any, pillarId: string, result: any) {
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

export async function loadProject(id: string): Promise<any | null> {
  const { data, error } = await supabase.from('projects').select('data').eq('id', id).single()
  if (error || !data) return null
  return data.data
}

export async function saveProject(project: any) {
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

export function parseJsonFromText(text: string): any {
  let cleaned = text.replace(/```json\n?/gi, '').replace(/```\n?/gi, '').trim()
  const start = cleaned.indexOf('{')
  if (start === -1) throw new Error('No JSON object found in SiaGPT response')
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

// pdfjs-dist (used internally by pdf-parse) reaches for the browser's DOMMatrix
// during content-stream parsing even for plain text extraction. It tries to load
// the native `@napi-rs/canvas` package for a real implementation, but that native
// binary is unreliable to trace into Vercel's serverless bundle, so provide a pure-JS
// fallback that covers the 2D matrix ops pdfjs actually touches.
function ensureDOMMatrixPolyfill() {
  if (typeof (globalThis as any).DOMMatrix !== 'undefined') return
  class DOMMatrixPolyfill {
    a = 1; b = 0; c = 0; d = 1; e = 0; f = 0
    constructor(init?: number[]) {
      if (init && init.length === 6) [this.a, this.b, this.c, this.d, this.e, this.f] = init
    }
    multiplySelf(o: DOMMatrixPolyfill) {
      const { a, b, c, d, e, f } = this
      this.a = a * o.a + c * o.b
      this.b = b * o.a + d * o.b
      this.c = a * o.c + c * o.d
      this.d = b * o.c + d * o.d
      this.e = a * o.e + c * o.f + e
      this.f = b * o.e + d * o.f + f
      return this
    }
    multiply(o: DOMMatrixPolyfill) {
      return new DOMMatrixPolyfill([this.a, this.b, this.c, this.d, this.e, this.f]).multiplySelf(o)
    }
    translateSelf(tx = 0, ty = 0) { return this.multiplySelf(new DOMMatrixPolyfill([1, 0, 0, 1, tx, ty])) }
    translate(tx = 0, ty = 0) { return this.multiply(new DOMMatrixPolyfill([1, 0, 0, 1, tx, ty])) }
    scaleSelf(sx = 1, sy = sx) { return this.multiplySelf(new DOMMatrixPolyfill([sx, 0, 0, sy, 0, 0])) }
    scale(sx = 1, sy = sx) { return this.multiply(new DOMMatrixPolyfill([sx, 0, 0, sy, 0, 0])) }
    invertSelf() {
      const det = this.a * this.d - this.b * this.c
      const { a, b, c, d, e, f } = this
      this.a = d / det; this.b = -b / det; this.c = -c / det; this.d = a / det
      this.e = (c * f - d * e) / det; this.f = (b * e - a * f) / det
      return this
    }
    transformPoint(p: { x: number; y: number } = { x: 0, y: 0 }) {
      return { x: this.a * p.x + this.c * p.y + this.e, y: this.b * p.x + this.d * p.y + this.f, z: 0, w: 1 }
    }
  }
  ;(globalThis as any).DOMMatrix = DOMMatrixPolyfill
}

export async function extractText(buffer: Buffer, mimetype: string, originalName: string): Promise<string> {
  try {
    const ext = originalName.toLowerCase().split('.').pop() || ''
    if (mimetype === 'application/pdf' || ext === 'pdf') {
      ensureDOMMatrixPolyfill()
      const { PDFParse } = await import('pdf-parse')
      const parser = new PDFParse({ data: buffer })
      try {
        const result = await parser.getText()
        return result.text || ''
      } finally {
        await parser.destroy()
      }
    }
    if (mimetype.includes('wordprocessingml') || ext === 'docx' || ext === 'doc') {
      const mammoth = await import('mammoth')
      const result = await mammoth.extractRawText({ buffer })
      return result.value || ''
    }
    if (mimetype.includes('spreadsheetml') || ext === 'xlsx' || ext === 'xls') {
      const XLSX = await import('xlsx')
      const workbook = XLSX.read(buffer)
      let text = ''
      workbook.SheetNames.forEach(sheetName => {
        const sheet = workbook.Sheets[sheetName]
        text += `\n=== Sheet: ${sheetName} ===\n`
        text += XLSX.utils.sheet_to_csv(sheet)
      })
      return text
    }
    if (mimetype.includes('presentationml') || ext === 'pptx') return `[PPTX file: ${originalName}]`
    if (mimetype.includes('image')) return `[Image file: ${originalName}]`
    return ''
  } catch (err: any) {
    console.error('Text extraction error:', err.message)
    return `[Extraction failed: ${err.message}]`
  }
}
