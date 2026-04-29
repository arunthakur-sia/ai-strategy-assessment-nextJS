#!/usr/bin/env node
/**
 * API-level integration test: project creation with holding company + 2 subsidiaries,
 * collection creation, and document upload for all three.
 *
 * Run:  node test-api.mjs
 * Requires the backend to be running on port 3001.
 */

const BASE = 'http://localhost:3001'
const PROJECT_PASSWORD = 'Test1234!'

// ── helpers ──────────────────────────────────────────────────────────────────

let sessionCookie = ''
const results = []

function pass(label, detail = '') {
  results.push({ ok: true, label, detail })
  console.log(`  ✅  ${label}${detail ? ' — ' + detail : ''}`)
}

function fail(label, detail = '') {
  results.push({ ok: false, label, detail })
  console.error(`  ❌  ${label}${detail ? ' — ' + detail : ''}`)
}

async function api(method, urlPath, body) {
  const headers = { 'Content-Type': 'application/json' }
  if (sessionCookie) headers['Cookie'] = sessionCookie
  const resp = await fetch(`${BASE}${urlPath}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  // Persist the session cookie so subsequent requests are authenticated
  const sc = resp.headers.get('set-cookie')
  if (sc) sessionCookie = sc.split(';')[0]
  return resp
}

async function uploadFile(urlPath, fieldName, fileBuffer, fileName, mimeType) {
  const form = new FormData()
  const blob = new Blob([fileBuffer], { type: mimeType })
  form.append(fieldName, blob, fileName)
  form.append('docType', 'general')
  form.append('docLabel', fileName)
  const headers = {}
  if (sessionCookie) headers['Cookie'] = sessionCookie
  const resp = await fetch(`${BASE}${urlPath}`, {
    method: 'POST',
    headers,
    body: form,
  })
  const sc = resp.headers.get('set-cookie')
  if (sc) sessionCookie = sc.split(';')[0]
  return resp
}

// Minimal 1×1 white JPEG — broadly accepted by every file filter
const JPEG_1x1 = Buffer.from(
  'FFD8FFE000104A46494600010100000100010000FFDB004300080606070605080707070909080A0C14' +
  '0D0C0B0B0C1912130F141D1A1F1E1D1A1C1C20242E27202224231C1C283729' +
  '2C3031343434182839333832' +
  'FFC0000B080001000101011100FFC4001F0000010501010101010000000000000001020304050607' +
  '08090A0BFFDA00080101000003F0FC28A28AFFD9',
  'hex'
)

// ── wait for backend ──────────────────────────────────────────────────────────

async function waitForBackend(timeoutMs = 30_000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(`${BASE}/api/config`)
      if (r.ok) return true
    } catch { /* not up yet */ }
    await new Promise(r => setTimeout(r, 800))
  }
  return false
}

// ── main test ─────────────────────────────────────────────────────────────────

console.log('\n══════════════════════════════════════════════════════')
console.log('  SIA-GPT API Integration Test')
console.log('  Collection creation + document upload')
console.log('══════════════════════════════════════════════════════\n')

console.log('⏳  Waiting for backend at', BASE, '...')
const up = await waitForBackend()
if (!up) {
  console.error('\n❌  Backend not reachable after 30 s — start it first:\n')
  console.error('    cd backend && npm run dev\n')
  process.exit(1)
}
console.log('✅  Backend is up\n')

// ─────────────────────────────────────────────────────────────────────────────
// 1. Create project with holding + 2 subsidiaries
// ─────────────────────────────────────────────────────────────────────────────
console.log('── Step 1: Create project ───────────────────────────')
const projectPayload = {
  name: 'API-Test Project',
  entityName: 'Holding Co Test',
  entityType: 'holding',
  password: PROJECT_PASSWORD,
  consultantName: 'Test Script',
  entities: [
    { name: 'Subsidiary Alpha', type: 'subsidiary' },
    { name: 'Subsidiary Beta',  type: 'subsidiary' },
  ],
}

let project = null
let entity1 = null
let entity2 = null

try {
  const r = await api('POST', '/api/projects', projectPayload)
  const body = await r.json()

  if (!r.ok) {
    fail('Create project', `HTTP ${r.status} — ${JSON.stringify(body)}`)
  } else {
    pass('Create project', `id=${body.id}, entities=${body.entityCount}`)
    project = body
  }
} catch (e) {
  fail('Create project', e.message)
}

if (!project) {
  console.error('\nCannot continue without a project — aborting.\n')
  process.exit(1)
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Fetch full project to inspect collection IDs
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── Step 2: Verify collections created ───────────────')
let fullProject = null
try {
  const r = await api('GET', `/api/projects/${project.id}`)
  const body = await r.json()

  if (!r.ok) {
    fail('GET /api/projects/:id', `HTTP ${r.status} — ${JSON.stringify(body)}`)
  } else {
    fullProject = body
    const holdingCol = fullProject.siagptCollectionId || ''
    const entities   = fullProject.entities || []
    entity1 = entities[0] || null
    entity2 = entities[1] || null

    if (holdingCol) {
      pass('Holding company collection', holdingCol)
    } else {
      fail('Holding company collection', 'siagptCollectionId is empty — check SiaGPT credentials / folder ID')
    }

    if (entity1?.siagptCollectionId) {
      pass(`Entity-1 (${entity1.name}) collection`, entity1.siagptCollectionId)
    } else {
      fail(`Entity-1 collection`, entity1
        ? `siagptCollectionId empty for "${entity1.name}"`
        : 'No entity[0] found')
    }

    if (entity2?.siagptCollectionId) {
      pass(`Entity-2 (${entity2.name}) collection`, entity2.siagptCollectionId)
    } else {
      fail(`Entity-2 collection`, entity2
        ? `siagptCollectionId empty for "${entity2.name}"`
        : 'No entity[1] found')
    }
  }
} catch (e) {
  fail('GET project', e.message)
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Upload document to holding company
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── Step 3: Upload document — Holding Company ────────')
try {
  const r = await uploadFile(
    `/api/documents/${project.id}/upload`,
    'files',
    JPEG_1x1,
    'holding-test-doc.jpg',
    'image/jpeg'
  )
  const body = await r.json()

  if (!r.ok) {
    fail('Holding upload', `HTTP ${r.status} — ${JSON.stringify(body)}`)
  } else {
    const doc = body.documents?.[0]
    if (!doc) {
      fail('Holding upload', 'Response had no documents array')
    } else {
      const hasSiaId = !!doc.siagptMediaId
      if (hasSiaId) {
        pass('Holding upload → SiaGPT media created', `mediaId=${doc.siagptMediaId}`)
      } else {
        fail('Holding upload → SiaGPT media missing', 'siagptMediaId is empty — check SiaGPT upload call')
      }
    }
  }
} catch (e) {
  fail('Holding upload', e.message)
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Upload document to Entity 1
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── Step 4: Upload document — Entity 1 ───────────────')
if (!entity1) {
  fail('Entity-1 upload', 'Skipped — entity not found')
} else {
  try {
    const r = await uploadFile(
      `/api/documents/${project.id}/${entity1.id}/upload`,
      'files',
      JPEG_1x1,
      'entity1-test-doc.jpg',
      'image/jpeg'
    )
    const body = await r.json()

    if (!r.ok) {
      fail(`Entity-1 (${entity1.name}) upload`, `HTTP ${r.status} — ${JSON.stringify(body)}`)
    } else {
      const doc = body.documents?.[0]
      if (!doc) {
        fail(`Entity-1 upload`, 'Response had no documents array')
      } else {
        if (doc.siagptMediaId) {
          pass(`Entity-1 (${entity1.name}) upload → SiaGPT media created`, `mediaId=${doc.siagptMediaId}`)
        } else {
          fail(`Entity-1 (${entity1.name}) upload → SiaGPT media missing`, 'siagptMediaId is empty')
        }
      }
    }
  } catch (e) {
    fail(`Entity-1 upload`, e.message)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. Upload document to Entity 2
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── Step 5: Upload document — Entity 2 ───────────────')
if (!entity2) {
  fail('Entity-2 upload', 'Skipped — entity not found')
} else {
  try {
    const r = await uploadFile(
      `/api/documents/${project.id}/${entity2.id}/upload`,
      'files',
      JPEG_1x1,
      'entity2-test-doc.jpg',
      'image/jpeg'
    )
    const body = await r.json()

    if (!r.ok) {
      fail(`Entity-2 (${entity2.name}) upload`, `HTTP ${r.status} — ${JSON.stringify(body)}`)
    } else {
      const doc = body.documents?.[0]
      if (!doc) {
        fail(`Entity-2 upload`, 'Response had no documents array')
      } else {
        if (doc.siagptMediaId) {
          pass(`Entity-2 (${entity2.name}) upload → SiaGPT media created`, `mediaId=${doc.siagptMediaId}`)
        } else {
          fail(`Entity-2 (${entity2.name}) upload → SiaGPT media missing`, 'siagptMediaId is empty')
        }
      }
    }
  } catch (e) {
    fail(`Entity-2 upload`, e.message)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. Embedding status — all three collections
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── Step 6: Embedding status ──────────────────────────')

// Holding
try {
  const r = await api('GET', `/api/documents/${project.id}/embedding-status`)
  const body = await r.json()
  if (!r.ok) {
    fail('Holding embedding-status', `HTTP ${r.status} — ${JSON.stringify(body)}`)
  } else {
    const files = Object.keys(body.status || {})
    pass('Holding embedding-status', files.length
      ? `${files.length} file(s): ${files.join(', ')}`
      : '(no files indexed yet — normal if ingestion is async)')
  }
} catch (e) {
  fail('Holding embedding-status', e.message)
}

// Entity 1
if (entity1) {
  try {
    const r = await api('GET', `/api/documents/${project.id}/${entity1.id}/embedding-status`)
    const body = await r.json()
    if (!r.ok) {
      fail(`Entity-1 embedding-status`, `HTTP ${r.status} — ${JSON.stringify(body)}`)
    } else {
      const files = Object.keys(body.status || {})
      pass(`Entity-1 (${entity1.name}) embedding-status`, files.length
        ? `${files.length} file(s): ${files.join(', ')}`
        : '(no files indexed yet — normal)')
    }
  } catch (e) {
    fail(`Entity-1 embedding-status`, e.message)
  }
}

// Entity 2
if (entity2) {
  try {
    const r = await api('GET', `/api/documents/${project.id}/${entity2.id}/embedding-status`)
    const body = await r.json()
    if (!r.ok) {
      fail(`Entity-2 embedding-status`, `HTTP ${r.status} — ${JSON.stringify(body)}`)
    } else {
      const files = Object.keys(body.status || {})
      pass(`Entity-2 (${entity2.name}) embedding-status`, files.length
        ? `${files.length} file(s): ${files.join(', ')}`
        : '(no files indexed yet — normal)')
    }
  } catch (e) {
    fail(`Entity-2 embedding-status`, e.message)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. Final report
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n══════════════════════════════════════════════════════')
console.log('  RESULTS')
console.log('══════════════════════════════════════════════════════')

const total   = results.length
const passed  = results.filter(r => r.ok).length
const failed  = results.filter(r => !r.ok).length

console.log(`\n  Passed : ${passed} / ${total}`)
if (failed > 0) {
  console.log(`  Failed : ${failed}\n`)
  console.log('  Failures:')
  results.filter(r => !r.ok).forEach(r => console.log(`    • ${r.label}: ${r.detail}`))
}

if (project) {
  console.log(`\n  Project ID : ${project.id}`)
  console.log(`  Password   : ${PROJECT_PASSWORD}`)
  console.log(`  (run again without conflicts — each run creates a fresh project)\n`)
}

process.exit(failed > 0 ? 1 : 0)
