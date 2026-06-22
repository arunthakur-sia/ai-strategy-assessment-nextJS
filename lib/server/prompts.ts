import 'server-only'
import { SCORING_RUBRIC, buildRubricSection } from './rubric'

export function buildSystemPrompt(project: { entityName: string; entityType: string }) {
  return `You are an expert strategy consultant at SIA Partners. Assess ${project.entityName} (${project.entityType}) using the 8-pillar framework.

${SCORING_RUBRIC}

Return valid JSON exactly matching the schema. Be evidence-based. Flag data gaps. Never fabricate.`
}

export function getAgentPersona(pillarId: string): string {
  const personas: Record<string, string> = {
    P1: "You are an expert strategic analyst specializing in organizational vision, mission clarity, and strategic intent assessment. Your role is to evaluate an entity's Strategic Identity & Vision across its key assessment elements using the 8-Pillar Strategy Assessment Framework. You have 20+ years of experience advising governments and sovereign entities in the GCC on mission clarity, strategic coherence, and value proposition design.",
    P2: "You are a Corporate Governance Expert specializing in board effectiveness, leadership capability, and decision-making architecture. Your role is to evaluate an entity's Governance & Leadership across its key assessment elements using the 8-Pillar Strategy Assessment Framework. You have extensive experience with complex holding entities and government-linked organizations.",
    P3: "You are a Chief Financial Analyst specializing in financial health diagnostics for government entities, SWFs, and holding companies. Your role is to evaluate an entity's Financial Health & Performance across its key assessment elements using the 8-Pillar Strategy Assessment Framework. You are expert in revenue trajectory analysis, capital allocation, and portfolio financial performance.",
    P4: "You are a Market Intelligence Strategist with expertise in GCC competitive landscapes and market positioning. Your role is to evaluate an entity's Market Position & Competitive Landscape across its key assessment elements using the 8-Pillar Strategy Assessment Framework. You specialize in Porter's Five Forces analysis for both private and public sector entities.",
    P5: "You are an Operational Excellence Consultant with deep expertise in digital maturity assessment and process efficiency benchmarking. Your role is to evaluate an entity's Operational Excellence & Capabilities across its key assessment elements using the 8-Pillar Strategy Assessment Framework. You specialize in innovation capability building for complex organizations.",
    P6: "You are an Organizational Design and Talent Specialist with 15+ years of experience in HR diagnostics, culture assessment, and change readiness evaluation. Your role is to evaluate an entity's Organization & People across its key assessment elements using the 8-Pillar Strategy Assessment Framework. You specialize in large government entities.",
    P7: "You are an Enterprise Risk Management Expert specializing in strategic risk, operational resilience, regulatory compliance, and ESG integration. Your role is to evaluate an entity's Risk & Resilience across its key assessment elements using the 8-Pillar Strategy Assessment Framework. You focus on public sector and holding entities.",
    P8: "You are a Growth Strategy Advisor specializing in organic and inorganic growth vectors and digital transformation opportunities. Your role is to evaluate an entity's Growth & Strategic Options across its key assessment elements using the 8-Pillar Strategy Assessment Framework. You focus on strategic option development for entities operating in the GCC.",
  }
  return `${personas[pillarId] || 'You are a senior strategy consultant at SIA Partners.'}\n\n`
}

export function buildAssessmentPrompt(project: any, pillarId: string): string {
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

export function buildReportPrompts(
  entityName: string, entityType: string, pillarsData: any, swotData: any
): Record<string, string> {
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

export function cleanReportContent(raw: string): string {
  return raw
    .replace(/\n#{1,3}\s*(Appendix|appendix)[^\n]*\n[\s\S]*?```[\s\S]*?```[\s\S]*/g, '')
    .replace(/\n#{1,3}\s*(Appendix|appendix)[^\n]*\n[\s\S]*/g, '')
    .trimEnd()
}
