import { visit } from 'unist-util-visit'

// Matches Wave 1 agent citation markers like "[1-5]" or "[1-5, 1-28, 2-3]" — bare brackets containing
// one or more comma-separated tokens, as emitted by the SiaGPT narrative/chat assistants. Each whole
// token (e.g. "1-5") is itself a unique source key — the analogue of the uuid in the pillar/fanout
// assistants' "**[<48,uuid>]**" format (see CitedText.tsx), which this plugin does not touch. It is NOT
// a "document-chunk" pair to split apart; two different tokens can be entirely unrelated sources.
//
// Wave 2 agents cite by raw source uuid instead — in prose as "[<uuid>]" / "**[<48,uuid>]**" and, in the
// response tables, as a bare uuid in a "Source" cell. Those are accepted here too, as tokens that are just
// the uuid itself, so they render as the same clickable numbered bubble.
const UUID = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}'
const ITEM = `(?:<\\d+\\s*,\\s*${UUID}>|${UUID}|\\d{1,4}-\\d{1,4})`
const WAVE1_GROUP_RE = new RegExp(
  `\\*{0,2}\\[\\s*(${ITEM}(?:\\s*[,;]\\s*${ITEM})*)\\s*\\]\\*{0,2}|\\b(${UUID})\\b`, 'g'
)
const TOKEN_RE = new RegExp(`<\\d+\\s*,\\s*(${UUID})>|(${UUID})|(\\d{1,4}-\\d{1,4})`, 'g')

function tokensOf(match: RegExpExecArray): string[] {
  const raw = match[1] ?? match[2]
  const out: string[] = []
  TOKEN_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = TOKEN_RE.exec(raw)) !== null) {
    const t = (m[1] ?? m[2] ?? m[3]).toLowerCase()
    if (!out.includes(t)) out.push(t)
  }
  return out
}

/**
 * A remark plugin that splices Wave 1 citation markers out of text nodes and replaces them with a
 * `wave1cite` hast element (via mdast `data.hName`/`hProperties`), so react-markdown can render them as
 * clickable badges via a `components={{ wave1cite: ... }}` entry — the citation survives markdown's own
 * inline parsing (bold, links, etc.) intact and stays inline with its surrounding sentence.
 *
 * The raw tokens are passed through as-is (comma-separated, deduped within the marker group) — the
 * caller is responsible for mapping each unique token to a display number and a resolved source, since
 * that mapping spans the whole conversation, not just one message.
 */
export function remarkWave1Citations() {
  return (tree: any) => {
    visit(tree, 'text', (node: any, index: number | null | undefined, parent: any) => {
      if (!parent || index == null) return
      const value: string = node.value
      WAVE1_GROUP_RE.lastIndex = 0
      if (!WAVE1_GROUP_RE.test(value)) return
      WAVE1_GROUP_RE.lastIndex = 0

      const newNodes: any[] = []
      let lastIndex = 0
      let match: RegExpExecArray | null
      while ((match = WAVE1_GROUP_RE.exec(value)) !== null) {
        if (match.index > lastIndex) {
          newNodes.push({ type: 'text', value: value.slice(lastIndex, match.index) })
        }
        const tokens = tokensOf(match)
        newNodes.push({
          type: 'wave1Citation',
          data: { hName: 'wave1cite', hProperties: { tokens: tokens.join(',') } },
          children: [],
        })
        lastIndex = WAVE1_GROUP_RE.lastIndex
      }
      if (lastIndex < value.length) newNodes.push({ type: 'text', value: value.slice(lastIndex) })

      parent.children.splice(index, 1, ...newNodes)
    })
  }
}

/** Extracts unique Wave 1 citation tokens from a plain string, in order of first appearance. Used to
 *  build a conversation-wide token → display-number map (see AgentDrawer in AssessmentPage.tsx). */
export function extractWave1Tokens(text: string): string[] {
  const seen = new Set<string>()
  const ordered: string[] = []
  WAVE1_GROUP_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = WAVE1_GROUP_RE.exec(text)) !== null) {
    for (const token of tokensOf(match)) {
      if (!seen.has(token)) { seen.add(token); ordered.push(token) }
    }
  }
  return ordered
}

/** Rewrites every citation marker in `text` to a plain "[n]" / "[n, m]" using a conversation-wide
 *  token → display-number map (the same one the sources panel uses), so exported reports cite sources by
 *  the numbers listed in their references section. Tokens missing from the map are dropped. */
export function replaceWave1Citations(text: string, tokenToNum: Record<string, number>): string {
  WAVE1_GROUP_RE.lastIndex = 0
  return text.replace(WAVE1_GROUP_RE, (...args) => {
    const m = args.slice(0, args.length - 2) as any
    const match = [m[0], m[1], m[2]] as unknown as RegExpExecArray
    const nums = Array.from(new Set(tokensOf(match).map(t => tokenToNum[t]).filter(n => n != null))).sort((a, b) => a - b)
    return nums.length ? `[${nums.join(', ')}]` : ''
  })
}
