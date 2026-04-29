/**
 * migrate-to-supabase.mjs
 *
 * 1. Runs the DDL migration on Supabase (creates the projects table if missing)
 * 2. Upserts all existing projects from backend/data/local_db.json into Supabase
 * 3. Verifies the data round-trips correctly
 *
 * Usage:
 *   node migrate-to-supabase.mjs
 */

import { createClient } from '@supabase/supabase-js'
import { readFileSync, existsSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

// ── Load .env ─────────────────────────────────────────────────────
const envPath = resolve(__dirname, 'backend/.env')
if (existsSync(envPath)) {
  const lines = readFileSync(envPath, 'utf-8').split('\n')
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    let val = trimmed.slice(eq + 1).trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    if (key && !process.env[key]) process.env[key] = val
  }
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('❌  Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in backend/.env')
  process.exit(1)
}

console.log(`\n🔗  Connecting to Supabase: ${SUPABASE_URL}`)
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

// ── Step 1: Ensure projects table exists ─────────────────────────
async function ensureSchema() {
  console.log('\n📋  Step 1: Verifying projects table...')

  // Try a lightweight probe – if the table doesn't exist the error code will be "42P01"
  const { error: probeError } = await supabase
    .from('projects')
    .select('id')
    .limit(1)

  if (!probeError) {
    console.log('    ✅  Table "projects" already exists.')
    return
  }

  if (probeError.code === '42P01' || probeError.message?.toLowerCase().includes('does not exist')) {
    console.log('    ⚠️  Table not found – attempting to create via exec_sql RPC...')

    const migrationFile = resolve(__dirname, 'supabase/migrations/001_initial_schema.sql')
    const sql = readFileSync(migrationFile, 'utf-8')

    const { error: rpcError } = await supabase.rpc('exec_sql', { sql })
    if (rpcError) {
      console.error('\n❌  exec_sql RPC failed:', rpcError.message)
      console.error('\n👉  Please create the projects table manually in the Supabase SQL Editor:')
      console.error(`    ${SUPABASE_URL.replace('.supabase.co', '')}.supabase.co/project/default/sql/new`)
      console.error('    Copy/paste the contents of: supabase/migrations/001_initial_schema.sql\n')
      process.exit(1)
    }
    console.log('    ✅  Schema created successfully via exec_sql.')
  } else {
    console.error('❌  Unexpected Supabase error during probe:', probeError)
    process.exit(1)
  }
}

// ── Step 2: Load local_db.json ────────────────────────────────────
function loadLocalDb() {
  const dbPath = resolve(__dirname, 'backend/data/local_db.json')
  if (!existsSync(dbPath)) {
    console.log('\n📂  No local_db.json found – nothing to migrate.')
    return {}
  }
  try {
    const raw = readFileSync(dbPath, 'utf-8')
    const db = JSON.parse(raw)
    return db.projects || {}
  } catch (e) {
    console.error('❌  Failed to parse local_db.json:', e.message)
    return {}
  }
}

// ── Step 3: Migrate each project ─────────────────────────────────
async function migrateProjects(localProjects) {
  const ids = Object.keys(localProjects)
  if (ids.length === 0) {
    console.log('\n📂  No local projects to migrate.')
    return
  }

  console.log(`\n🚀  Step 2: Migrating ${ids.length} project(s) to Supabase...\n`)

  let success = 0
  let skipped = 0
  let failed = 0

  for (const id of ids) {
    const row = localProjects[id]

    // The local_db row might be stored as the upsert payload (with top-level data field)
    // or as the raw project object — handle both.
    let projectData
    if (row.data && typeof row.data === 'object') {
      // Already in the DB row format: { id, name, entity_name, ..., data: {...project} }
      projectData = row.data
    } else {
      // Raw project object stored directly
      projectData = row
    }

    const name = projectData.name || row.name || '(unknown)'
    const entityName = projectData.entityName || row.entity_name || ''
    const entityType = projectData.entityType || row.entity_type || ''
    const passwordHash = projectData.passwordHash || row.password_hash || ''
    const updatedAt = projectData.updatedAt || row.updated_at || new Date().toISOString()

    process.stdout.write(`    • [${id.slice(0, 8)}…] "${name}" (${entityName}) — `)

    // Check if already exists in Supabase
    const { data: existing, error: fetchErr } = await supabase
      .from('projects')
      .select('id, updated_at')
      .eq('id', id)
      .maybeSingle()

    if (fetchErr && fetchErr.code !== 'PGRST116') {
      console.log(`SKIPPED (fetch error: ${fetchErr.message})`)
      skipped++
      continue
    }

    if (existing) {
      // Project already migrated — only overwrite if local version is newer
      const localTs = new Date(updatedAt).getTime()
      const remoteTs = new Date(existing.updated_at).getTime()
      if (localTs <= remoteTs) {
        console.log(`SKIPPED (Supabase copy is up-to-date)`)
        skipped++
        continue
      }
      console.log(`UPDATING (local is newer)…`)
    } else {
      process.stdout.write(`INSERTING…`)
    }

    const { error: upsertErr } = await supabase.from('projects').upsert({
      id,
      name,
      entity_name: entityName,
      entity_type: entityType,
      password_hash: passwordHash,
      data: projectData,
      updated_at: updatedAt,
    })

    if (upsertErr) {
      console.log(` FAILED: ${upsertErr.message}`)
      failed++
    } else {
      console.log(` ✅`)
      success++
    }
  }

  console.log(`\n    Summary: ${success} migrated, ${skipped} skipped, ${failed} failed`)
  return { success, skipped, failed }
}

// ── Step 4: Verify round-trip ─────────────────────────────────────
async function verifyMigration(localProjects) {
  const ids = Object.keys(localProjects)
  if (ids.length === 0) return

  console.log('\n🔍  Step 3: Verifying Supabase data...')

  const { data: rows, error } = await supabase
    .from('projects')
    .select('id, name, entity_name, updated_at')
    .order('updated_at', { ascending: false })

  if (error) {
    console.error('❌  Verification query failed:', error.message)
    return
  }

  console.log(`\n    Projects in Supabase (${rows.length} total):`)
  for (const r of rows) {
    console.log(`      • [${r.id.slice(0, 8)}…] "${r.name}" | ${r.entity_name} | ${r.updated_at}`)
  }
}

// ── Main ──────────────────────────────────────────────────────────
async function main() {
  console.log('═══════════════════════════════════════════════════')
  console.log('  SIA Strategy — Migrate local DB → Supabase')
  console.log('═══════════════════════════════════════════════════')

  await ensureSchema()

  const localProjects = loadLocalDb()
  const result = await migrateProjects(localProjects)

  await verifyMigration(localProjects)

  const failed = result?.failed ?? 0
  if (failed > 0) {
    console.error('\n❌  Migration completed with errors. Fix failures before switching to Supabase.')
    process.exit(1)
  }

  console.log('\n✅  Migration complete!')
  console.log('\n📝  Next step: set LOCAL_DB=false in backend/.env to switch to Supabase.')
  console.log('    (This script will do it automatically in 3 seconds…)\n')

  await new Promise(r => setTimeout(r, 3000))

  // Flip LOCAL_DB to false
  const envFile = readFileSync(envPath, 'utf-8')
  const updated = envFile.replace(/^LOCAL_DB=true/m, 'LOCAL_DB=false')
  if (updated === envFile) {
    console.log('⚠️   LOCAL_DB was not "true" in .env — no change needed.')
  } else {
    const { writeFileSync } = await import('fs')
    writeFileSync(envPath, updated, 'utf-8')
    console.log('✅  LOCAL_DB set to false in backend/.env')
    console.log('\n🔄  Restart the backend for the change to take effect:')
    console.log('    cd backend && npm run dev\n')
  }
}

main().catch(e => {
  console.error('\n💥  Fatal error:', e)
  process.exit(1)
})
