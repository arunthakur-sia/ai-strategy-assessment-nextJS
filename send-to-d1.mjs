#!/usr/bin/env node
/**
 * Send a question to the D1 agent (Strategic Perception & Hypothesis Report)
 * and save the raw SiaGPT response to test-response.txt
 */
import { readFileSync, writeFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

// ── Load .env ─────────────────────────────────────────────────────────────────
function loadEnv(filePath) {
  const env = {}
  try {
    const lines = readFileSync(filePath, 'utf8').split('\n')
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eqIdx = trimmed.indexOf('=')
      if (eqIdx < 1) continue
      const key = trimmed.slice(0, eqIdx).trim()
      let val = trimmed.slice(eqIdx + 1).trim()
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1)
      }
      env[key] = val
    }
  } catch (e) {
    console.error('Could not read .env:', e.message)
  }
  return env
}

const env = loadEnv(resolve(__dirname, 'backend/.env'))

const SIAGPT_BASE_URL   = env.SIAGPT_BASE_URL   || 'https://backend.siagpt.ai'
const OAUTH2_TOKEN_URL  = env.OAUTH2_TOKEN_URL  || ''
const OAUTH2_CLIENT_ID  = env.OAUTH2_CLIENT_ID  || ''
const OAUTH2_CLIENT_SECRET = env.OAUTH2_CLIENT_SECRET || ''
const ZITADEL_PROJECT_ID = env.ZITADEL_PROJECT_ID || ''
const SIAGPT_BEARER_TOKEN = env.SIAGPT_BEARER_TOKEN || ''
const SIAGPT_OWNER_ID   = env.SIAGPT_OWNER_ID   || '019cd318-5f66-7f23-a114-3400179bc75c'
const D1_ASSISTANT_ID   = env.SIAGPT_ASSISTANT_D1 || '019dd2dc-30d6-7aa3-9fea-ab9a4f55abb0'
const SIAGPT_BUNDLE_ID  = env.SIAGPT_BUNDLE_ID  || ''

const QUESTION = 'make a docx of one page hello world using file generation tool'
const OUTPUT_FILE = resolve(__dirname, 'test-response.txt')

// ── Auth ─────────────────────────────────────────────────────────────────────
async function getToken() {
  if (SIAGPT_BEARER_TOKEN) {
    console.log('Using static bearer token')
    return SIAGPT_BEARER_TOKEN
  }
  if (!OAUTH2_TOKEN_URL || !OAUTH2_CLIENT_ID || !OAUTH2_CLIENT_SECRET || !ZITADEL_PROJECT_ID) {
    throw new Error('No auth credentials available — set SIAGPT_BEARER_TOKEN or OAuth2 vars in .env')
  }
  console.log('Requesting OAuth2 token from Zitadel...')
  const scopeParams = [
    'openid',
    'urn:zitadel:iam:user:resourceowner',
    `urn:zitadel:iam:org:project:id:${ZITADEL_PROJECT_ID}:aud`,
    'urn:zitadel:iam:org:projects:roles',
  ].join('+')
  const authStr = Buffer.from(`${OAUTH2_CLIENT_ID}:${OAUTH2_CLIENT_SECRET}`).toString('base64')
  const resp = await fetch(
    `${OAUTH2_TOKEN_URL}?grant_type=client_credentials&scope=${scopeParams}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${authStr}`,
      },
    }
  )
  if (!resp.ok) {
    const body = await resp.text()
    throw new Error(`OAuth2 token request failed ${resp.status}: ${body}`)
  }
  const data = await resp.json()
  const access = data.access_token
  const id = data.id_token
  const token = access?.split('.').length === 3 ? access : id ?? access
  if (!token) throw new Error('No usable JWT in OAuth2 response')
  console.log('OAuth2 token obtained')
  return token
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n=== Sending question to D1 agent ===')
  console.log(`Question : "${QUESTION}"`)
  console.log(`Assistant: ${D1_ASSISTANT_ID}`)
  console.log(`Output   : ${OUTPUT_FILE}`)
  console.log()

  const token = await getToken()

  // 1. Create discussion
  const discName = `D1 Test ${Date.now()}`
  console.log(`Creating discussion: "${discName}"`)
  const discResp = await fetch(`${SIAGPT_BASE_URL}/chat/discussions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'app-origin': 'AI Platform',
    },
    body: JSON.stringify({ name: discName, ownerId: SIAGPT_OWNER_ID, ownerType: 'USER' }),
  })
  if (!discResp.ok) {
    const body = await discResp.text()
    throw new Error(`Discussion creation failed ${discResp.status}: ${body}`)
  }
  const { uuid: discussionId } = await discResp.json()
  console.log(`Discussion created: ${discussionId}`)

  // 2. Build message payload (same structure as callSiaGPT in routes.ts)
  const { randomUUID } = await import('crypto')
  const messageId = randomUUID()

  const msgMeta = {
    assistantId: D1_ASSISTANT_ID,
    attachmentInfos: [],
    tools: ['rag', 'document_content', 'list_documents', 'query_table', 'list_table_schemas', 'file_generation'],
    ...(SIAGPT_BUNDLE_ID ? { bundleId: SIAGPT_BUNDLE_ID } : {}),
  }

  const msgPayload = {
    question: QUESTION,
    messageId,
    discussionId,
    ownerId: SIAGPT_OWNER_ID,
    ownerType: 'USER',
    messageMetadata: msgMeta,
  }

  console.log('\nRequest payload:')
  console.log(JSON.stringify(msgPayload, null, 2))
  console.log('\nPosting message to SiaGPT...')

  const startTime = Date.now()
  const msgResp = await fetch(`${SIAGPT_BASE_URL}/chat/messages/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'app-origin': 'AI Platform',
    },
    body: JSON.stringify(msgPayload),
  })

  const httpStatus = msgResp.status
  const rawBody = await msgResp.text()
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)

  console.log(`Response: HTTP ${httpStatus} (${rawBody.length} chars, ${elapsed}s)`)

  // 3. Build output file
  const timestamp = new Date().toISOString()
  const output = [
    '# SiaGPT Raw Response — D1 Agent Test',
    `# Timestamp : ${timestamp}`,
    `# HTTP Status: ${httpStatus}`,
    `# Length    : ${rawBody.length} chars`,
    `# Duration  : ${elapsed}s`,
    '#──────────────────────────────────────────────────────────────────────────────',
    '',
    '## REQUEST PAYLOAD',
    '',
    JSON.stringify(msgPayload, null, 2),
    '',
    '## RAW RESPONSE',
    '',
    rawBody,
  ].join('\n')

  writeFileSync(OUTPUT_FILE, output, 'utf8')
  console.log(`\nRaw response saved to: ${OUTPUT_FILE}`)

  // 4. Quick parse to show result summary
  if (!msgResp.ok) {
    console.error(`\nWARNING: HTTP ${httpStatus} — likely an error response`)
  } else {
    const events = rawBody.split('\n')
      .filter(l => l.trim())
      .map(l => { const p = l.startsWith('data: ') ? l.slice(6) : l; try { return JSON.parse(p) } catch { return null } })
      .filter(Boolean)

    const overwrite = events.find(e => e.event === 'OVERWRITE_TEXT')
    const chat = events.find(e => e.event === 'CHAT')
    const errorEv = events.find(e => e.event === 'NEW_ERROR')
    const chosen = overwrite ?? chat ?? events[events.length - 1]

    if (errorEv) {
      console.error('\nAgent returned an error:', JSON.stringify(errorEv))
    } else {
      const text = String(chosen?.data ?? chosen?.content ?? '(no text extracted)')
      console.log('\n--- Response preview (first 500 chars) ---')
      console.log(text.slice(0, 500))
      if (text.length > 500) console.log(`... (${text.length} total chars)`)
    }
  }
}

main().catch(e => {
  console.error('Fatal error:', e.message)
  process.exit(1)
})
