import { NextRequest, NextResponse } from 'next/server'
import { callSiaGPT } from '@/lib/server/siagpt'
import { config } from '@/lib/server/config'
import { parseJsonFromText } from '@/lib/server/helpers'
import fs from 'fs'
import path from 'path'

export const runtime = 'nodejs'
export const maxDuration = 300

const rubricPath = path.join(process.cwd(), 'data', 'rubric.json')

export async function GET() {
  try {
    if (fs.existsSync(rubricPath)) {
      const cached = JSON.parse(fs.readFileSync(rubricPath, 'utf-8'))
      return NextResponse.json({ success: true, data: cached, cached: true })
    }
    return NextResponse.json({ success: true, data: null, cached: false })
  } catch (err: any) { return NextResponse.json({ error: err.message }, { status: 500 }) }
}

export async function POST(request: NextRequest) {
  try {
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
    const rubricData = parseJsonFromText(rawText)
    const dir = path.dirname(rubricPath)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(rubricPath, JSON.stringify(rubricData, null, 2))
    return NextResponse.json({ success: true, data: rubricData })
  } catch (err: any) { return NextResponse.json({ error: err.message }, { status: 500 }) }
}
