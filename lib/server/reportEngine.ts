import 'server-only'
import { config } from './config'
import { buildTranscriptText } from './wave1Engine'
import { replaceWave1Citations } from '../remarkWave1Citations'

export interface ReportSource { n: number; title?: string; description?: string; url?: string; type?: string }

const SYSTEM_PROMPT = `You are a senior partner at a top-tier strategy consultancy (SIA Partners). You convert the full working conversation between a reviewer and an AI analyst agent into a finished, client-ready report in Markdown.

Hard rules:
1. ZERO DATA LOSS. Every finding, number, score, rating, table row, quote, caveat, assumption, data gap, recommendation, reviewer correction and decision in the conversation must appear in the report. Never summarise away detail, never drop a table row, never round or alter figures. If the reviewer corrected the agent, report the corrected position (and note the correction where it changes a conclusion).
2. NO FABRICATION. Use only what is in the conversation. Do not invent facts, figures, sources or recommendations. Where the conversation flags missing data, keep that flag.
3. Remove conversational noise only: greetings, "sure, here is…", questions to the reviewer that were answered, tool/process chatter. Convert Q&A and iteration into a clean, final narrative.
4. Structure: a title (#), an "Executive Summary" (key conclusions first), then logically ordered sections (##/###) that cover the whole conversation, then "Key Risks & Data Gaps" and "Recommendations / Next Steps" where the content supports them. Keep source tables as GitHub-flavoured Markdown tables.
5. Tone: formal, concise, third person, board-ready. No emojis. No first-person AI voice. No mention of "the conversation", "the chat" or "the agent".
6. Citations: the text contains numeric citation markers like [3] or [2, 5]. Keep them attached to the claims they support, unchanged. Do not renumber or invent markers. Do NOT write a references section — it is appended automatically.
7. Output ONLY the Markdown report. No preamble, no code fences around it.`

export function buildReportMessages(opts: {
  entityName: string; agentLabel: string; scores?: { ai?: number | null; reviewer?: number | null; final?: number | null }
  chatHistory: any[]; tokenToNum: Record<string, number>
}) {
  const transcript = replaceWave1Citations(buildTranscriptText(opts.chatHistory), opts.tokenToNum)
  const s = opts.scores
  const scoreLine = s && (s.ai != null || s.reviewer != null || s.final != null)
    ? `\nScores: AI ${s.ai ?? 'n/a'} · Reviewer ${s.reviewer ?? 'n/a'} · Final ${s.final ?? 'n/a'} (scale 1-5) — include these in the report.`
    : ''
  const user = `Entity: ${opts.entityName}
Workstream: ${opts.agentLabel}${scoreLine}

Full conversation transcript follows. Produce the complete report.

<transcript>
${transcript}
</transcript>`
  return [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: user }]
}

/** "## References" section appended deterministically so citation numbers always match the sources panel.
 *  One line per source: "n. Document › Section — summary <link>". */
export function buildReferencesMarkdown(sources: ReportSource[]): string {
  if (!sources.length) return ''
  const clean = (t: string) => t.replace(/\s+/g, ' ').trim()
  const lines = sources
    .slice().sort((a, b) => a.n - b.n)
    .map(s => {
      const title = clean(s.title || '') || clean(s.description || '').slice(0, 120) || 'Untitled source'
      const desc = s.title && s.description ? ` — ${clean(s.description).slice(0, 300)}` : ''
      const url = s.url ? ` <${s.url}>` : ''
      return `${s.n}. ${title}${desc}${url}`
    })
  return `\n\n## References\n\n${lines.join('\n')}\n`
}

/** Streams the completion (SSE) rather than waiting on one response: a long report can take minutes and
 *  gateways/proxies drop connections that sit idle that long. Opus 4.6 allows up to 128k output tokens. */
export async function callReportLlm(messages: { role: string; content: string }[]): Promise<string> {
  const { baseUrl, apiKey, model, maxTokens } = config.reportLlm
  if (!apiKey) throw new Error('Report LLM is not configured — set REPORT_LLM_API_KEY in .env.local.')
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, messages, temperature: 0.2, max_tokens: maxTokens, stream: true }),
    signal: AbortSignal.timeout(780_000),
  })
  if (!res.ok || !res.body) throw new Error(`Report LLM request failed (${res.status}): ${(await res.text()).slice(0, 300)}`)

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = '', text = '', finish: string | null = null
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    let nl: number
    while ((nl = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, nl).trim()
      buf = buf.slice(nl + 1)
      if (!line.startsWith('data:')) continue
      const payload = line.slice(5).trim()
      if (!payload || payload === '[DONE]') continue
      try {
        const choice = JSON.parse(payload)?.choices?.[0]
        if (choice?.delta?.content) text += choice.delta.content
        if (choice?.finish_reason) finish = choice.finish_reason
      } catch { /* partial/keep-alive line */ }
    }
  }
  if (!text.trim()) throw new Error('Report LLM returned an empty response.')
  if (finish === 'length') {
    text += '\n\n> **Note:** this report was truncated by the model\'s output limit.'
  }
  return text.trim().replace(/^```(?:markdown|md)?\n([\s\S]*?)\n```$/i, '$1')
}
