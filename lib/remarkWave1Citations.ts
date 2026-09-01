import { visit } from 'unist-util-visit'

// Matches Wave 1 agent citation markers like "[1-5]" or "[1-5, 1-28, 2-3]" — bare brackets containing
// one or more comma-separated tokens, as emitted by the SiaGPT narrative/chat assistants. Each whole
// token (e.g. "1-5") is itself a unique source key — the analogue of the uuid in the pillar/fanout
// assistants' "**[<48,uuid>]**" format (see CitedText.tsx), which this plugin does not touch. It is NOT
// a "document-chunk" pair to split apart; two different tokens can be entirely unrelated sources.
const WAVE1_GROUP_RE = /\[(\d{1,4}-\d{1,4}(?:\s*,\s*\d{1,4}-\d{1,4})*)\]/g

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
        const tokens = Array.from(new Set(match[1].split(',').map(t => t.trim())))
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
    for (const token of match[1].split(',').map(t => t.trim())) {
      if (!seen.has(token)) { seen.add(token); ordered.push(token) }
    }
  }
  return ordered
}
