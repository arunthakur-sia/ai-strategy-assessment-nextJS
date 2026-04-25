// ── Structured logger for SIA Assessment backend ─────────────────────────────
// Outputs color-coded, timestamped blocks to stdout so every SiaGPT operation
// is immediately visible in the terminal.

const RESET  = '\x1b[0m'
const BOLD   = '\x1b[1m'
const DIM    = '\x1b[2m'
const CYAN   = '\x1b[36m'
const YELLOW = '\x1b[33m'
const GREEN  = '\x1b[32m'
const RED    = '\x1b[31m'
const MAGENTA = '\x1b[35m'
const BLUE   = '\x1b[34m'

function ts() {
  return `${DIM}${new Date().toISOString()}${RESET}`
}

function divider(color: string, label: string) {
  const line = '─'.repeat(60)
  console.log(`${color}${BOLD}┌${line}`)
  console.log(`│  ${label}`)
  console.log(`└${line}${RESET}`)
}

function kv(key: string, value: unknown, color = CYAN) {
  const str =
    typeof value === 'string'
      ? value
      : JSON.stringify(value, null, 2)
  console.log(`  ${color}${BOLD}${key}:${RESET} ${str}`)
}

// ── Public API ────────────────────────────────────────────────────────────────

export const log = {

  // Project lifecycle
  projectCreate(name: string, entityName: string, projectId: string) {
    divider(CYAN, `🏗  PROJECT CREATED`)
    kv('Project ID', projectId)
    kv('Name', name)
    kv('Entity', entityName)
    console.log(`  ${ts()}`)
    console.log()
  },

  // SiaGPT collection
  collectionRequest(name: string, description: string, folderId: string) {
    divider(YELLOW, `[siagpt] → POST /medias/collections  (Create Collection)`)
    kv('name', name, YELLOW)
    kv('description', description, YELLOW)
    kv('folderId', folderId, YELLOW)
    console.log(`  ${ts()}`)
    console.log()
  },

  collectionResponse(collectionId: string | null, name: string) {
    if (collectionId) {
      divider(GREEN, `[siagpt] ← 200  Collection Created`)
      kv('collectionId (uuid)', collectionId, GREEN)
      kv('name', name, GREEN)
    } else {
      divider(RED, `[siagpt] ← Collection creation skipped / failed`)
    }
    console.log(`  ${ts()}`)
    console.log()
  },

  // Document upload
  docUploadRequest(fileName: string, mimetype: string, collectionId: string) {
    divider(YELLOW, `[siagpt] → POST /medias/  (Upload Document to Collection)`)
    kv('file', fileName, YELLOW)
    kv('mimetype', mimetype, YELLOW)
    kv('collectionId', collectionId, YELLOW)
    console.log(`  ${ts()}`)
    console.log()
  },

  docUploadResponse(fileName: string, ok: boolean, status?: number) {
    if (ok) {
      divider(GREEN, `[siagpt] ← 200  Document Indexed`)
      kv('file', fileName, GREEN)
    } else {
      divider(RED, `[siagpt] ← ${status ?? '???'}  Document Upload Failed`)
      kv('file', fileName, RED)
    }
    console.log(`  ${ts()}`)
    console.log()
  },

  // Discussion creation
  discussionRequest(name: string, ownerId: string) {
    divider(CYAN, `[siagpt] → POST /chat/discussions`)
    kv('name', name, CYAN)
    kv('ownerId', ownerId, CYAN)
    kv('ownerType', 'USER', CYAN)
    console.log(`  ${ts()}`)
    console.log()
  },

  discussionResponse(discussionId: string) {
    divider(GREEN, `[siagpt] ← 200  Discussion Created`)
    kv('discussionId (uuid)', discussionId, GREEN)
    console.log(`  ${ts()}`)
    console.log()
  },

  // Message / agent call
  messageRequest(payload: {
    question: string
    messageId: string
    discussionId: string
    ownerId: string
    messageMetadata: Record<string, unknown>
    context?: string   // e.g. "pillar P1 assessment"
  }) {
    divider(MAGENTA, `[siagpt] → POST /chat/messages/  (${payload.context ?? 'LLM Call'})`)
    kv('messageId', payload.messageId, MAGENTA)
    kv('discussionId', payload.discussionId, MAGENTA)
    kv('ownerId', payload.ownerId, MAGENTA)
    if ((payload.messageMetadata as any).assistantId) {
      kv('assistantId', (payload.messageMetadata as any).assistantId, MAGENTA)
    }
    if ((payload.messageMetadata as any).collectionIds?.length) {
      kv('collectionIds', (payload.messageMetadata as any).collectionIds, MAGENTA)
    }
    kv('tools', (payload.messageMetadata as any).tools ?? [], MAGENTA)
    // Print question — truncate long prompts but keep full context visible
    const q = payload.question
    const preview = q.length > 1200 ? q.slice(0, 1200) + `\n  ${DIM}... [+${q.length - 1200} chars truncated]${RESET}` : q
    console.log(`  ${MAGENTA}${BOLD}question:${RESET}`)
    preview.split('\n').forEach(l => console.log(`    ${l}`))
    console.log(`  ${ts()}`)
    console.log()
  },

  messageResponse(raw: string, chosenEvent: string, context?: string) {
    divider(GREEN, `[siagpt] ← Response  (${context ?? 'LLM Call'})  event=${chosenEvent}`)
    const preview = raw.length > 1500
      ? raw.slice(0, 1500) + `\n  ${DIM}... [+${raw.length - 1500} chars truncated]${RESET}`
      : raw
    preview.split('\n').forEach(l => console.log(`  ${l}`))
    console.log(`  ${ts()}`)
    console.log()
  },

  messageError(err: string, context?: string) {
    divider(RED, `[siagpt] ✗ Error  (${context ?? 'LLM Call'})`)
    kv('error', err, RED)
    console.log(`  ${ts()}`)
    console.log()
  },

  // Generic info
  info(msg: string) {
    console.log(`${BLUE}${BOLD}[SIA]${RESET} ${ts()} ${msg}`)
  },

  warn(msg: string) {
    console.log(`${YELLOW}${BOLD}[WARN]${RESET} ${ts()} ${msg}`)
  },

  error(msg: string, err?: unknown) {
    console.error(`${RED}${BOLD}[ERROR]${RESET} ${ts()} ${msg}`, err ?? '')
  },
}
