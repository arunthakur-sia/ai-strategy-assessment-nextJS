/**
 * migrate-to-supabase.mjs
 *
 * 1. Runs the DDL migration on Supabase (creates the projects table if missing)
 * 2. Upserts all existing projects from backend/data/local_db.json into Supabase
 * 3. Flips LOCAL_DB=false in .env
 *
 * Usage (from the backend/ directory):
 *   node migrate-to-supabase.mjs
 */

import { createClient } from '@supabase/supabase-js'
import { readFileSync, existsSync, writeFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

// ── Load .env (in same directory as this script, i.e. backend/.env) ──────────
const envPath = resolve(__dirname, '.env')
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
} else {
  console.error('❌  backend/.env not found')
  process.exit(1)
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('❌  Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env')
  process.exit(1)
}

console.log(`\n🔗  Connecting to Supabase: ${SUPABASE_URL}`)
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

// ── Step 1: Ensure projects table exists ─────────────────────────
async function ensureSchema() {
  console.log('\n📋  Step 1: Verifying projects table...')

  const { error: probeError } = await supabase
    .from('projects')
    .select('id')
    .limit(1)

  if (!probeError) {
    console.log('    ✅  Table "projects" already exists.')
    return
  }

  const code = probeError.code
  const msg = probeError.message || ''
  if (code === '42P01' || msg.toLowerCase().includes('does not exist') || msg.includes('relation')) {
    console.log('    ⚠️  Table not found – running DDL migration via exec_sql RPC...')

    const migrationFile = resolve(__dirname, '../supabase/migrations/001_initial_schema.sql')
    const sql = readFileSync(migrationFile, 'utf-8')

    const { error: rpcError } = await supabase.rpc('exec_sql', { sql })
    if (rpcError) {
      console.error('\n❌  exec_sql RPC failed:', rpcError.message)
      console.error('\n👉  The "exec_sql" function does not exist in your Supabase project.')
      console.error('    Please run the migration SQL manually in the Supabase SQL Editor:')
      console.error(`    ${SUPABASE_URL}/project/default/sql/new`)
      console.error('    Copy the contents of: supabase/migrations/001_initial_schema.sql\n')
      console.error('\n    Alternatively, create the exec_sql helper function first:')
      console.error(`    CREATE OR REPLACE FUNCTION exec_sql(sql text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN EXECUTE sql; END; $$;`)
      console.error('    Then re-run this script.\n')
      process.exit(1)
    }
    console.log('    ✅  Schema created successfully.')
  } else {
    console.error('❌  Unexpected error during table probe:', JSON.stringify(probeError))
    process.exit(1)
  }
}

// ── Step 2: Load local_db.json ────────────────────────────────────
function loadLocalDb() {
  const dbPath = resolve(__dirname, 'data/local_db.json')
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
    return { success: 0, skipped: 0, failed: 0 }
  }

  console.log(`\n🚀  Step 2: Migrating ${ids.length} project(s) to Supabase...\n`)

  let success = 0
  let skipped = 0
  let failed = 0

  for (const id of ids) {
    const row = localProjects[id]

    // The local_db row is stored in DB row format: { id, name, entity_name, ..., data: {...project} }
    // The `data` field contains the full project object.
    let projectData
    if (row.data && typeof row.data === 'object') {
      projectData = row.data
    } else {
      projectData = row
    }

    const name = projectData.name || row.name || '(unknown)'
    const entityName = projectData.entityName || row.entity_name || ''
    const entityType = projectData.entityType || row.entity_type || ''
    const passwordHash = projectData.passwordHash || row.password_hash || ''
    const updatedAt = projectData.updatedAt || row.updated_at || new Date().toISOString()

    process.stdout.write(`    • [${id.slice(0, 8)}…] "${name}" (${entityName}) `)

    // Check if already exists in Supabase
    const { data: existing, error: fetchErr } = await supabase
      .from('projects')
      .select('id, updated_at')
      .eq('id', id)
      .maybeSingle()

    if (fetchErr && fetchErr.code !== 'PGRST116') {
      console.log(`→ SKIPPED (fetch error: ${fetchErr.message})`)
      skipped++
      continue
    }

    if (existing) {
      const localTs = new Date(updatedAt).getTime()
      const remoteTs = new Date(existing.updated_at).getTime()
      if (localTs <= remoteTs) {
        console.log(`→ SKIPPED (Supabase already up-to-date)`)
        skipped++
        continue
      }
      process.stdout.write(`→ UPDATING (local is newer)… `)
    } else {
      process.stdout.write(`→ INSERTING… `)
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
      console.log(`FAILED: ${upsertErr.message}`)
      failed++
    } else {
      console.log(`✅`)
      success++
    }
  }

  console.log(`\n    Summary: ${success} migrated, ${skipped} skipped, ${failed} failed`)
  return { success, skipped, failed }
}

// ── Step 4: Verify round-trip ─────────────────────────────────────
async function verifyMigration() {
  console.log('\n🔍  Step 3: Verifying Supabase data...')

  const { data: rows, error } = await supabase
    .from('projects')
    .select('id, name, entity_name, updated_at')
    .order('updated_at', { ascending: false })

  if (error) {
    console.error('    ❌  Verification query failed:', error.message)
    return
  }

  console.log(`\n    Projects in Supabase (${rows.length} total):`)
  for (const r of rows) {
    console.log(`      • [${r.id.slice(0, 8)}…] "${r.name}" | ${r.entity_name} | ${r.updated_at}`)
  }
}

// ── Step 5: Flip LOCAL_DB flag ────────────────────────────────────
function disableLocalDb() {
  const envFile = readFileSync(envPath, 'utf-8')
  const updated = envFile.replace(/^LOCAL_DB=true/m, 'LOCAL_DB=false')
  if (updated === envFile) {
    console.log('\n⚠️   LOCAL_DB was already not "true" — no .env change needed.')
  } else {
    writeFileSync(envPath, updated, 'utf-8')
    console.log('\n✅  LOCAL_DB=false written to .env')
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
  await verifyMigration()

  if (result.failed > 0) {
    console.error('\n❌  Migration completed with errors. Fix failures before switching to Supabase.')
    process.exit(1)
  }

  disableLocalDb()

  console.log('\n🎉  Done! Supabase is now the active database.')
  console.log('    Restart the backend server for changes to take effect:')
  console.log('      cd backend && npm run dev\n')
}

main().catch(e => {
  console.error('\n💥  Fatal error:', e)
  process.exit(1)
})
