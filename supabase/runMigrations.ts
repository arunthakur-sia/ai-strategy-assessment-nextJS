#!/usr/bin/env tsx
/**
 * Supabase Migration Runner
 *
 * Applies all SQL files in supabase/migrations/ in filename order.
 * Uses the SUPABASE_SERVICE_ROLE_KEY (bypasses RLS) so it can create
 * tables and triggers.
 *
 * Usage:
 *   cd backend/
 *   npx tsx src/runMigrations.ts
 *
 * Or via package.json script:
 *   npm run migrate
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { createClient } from '@supabase/supabase-js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// ── Load .env if present ─────────────────────────────────────────
const envPath = path.resolve(__dirname, '../../backend/.env')
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, 'utf-8').split('\n')
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    const val = trimmed.slice(eq + 1).trim()
    if (key && !process.env[key]) process.env[key] = val
  }
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error(
    '\n[Migration Error] Missing environment variables.\n' +
      'Make sure backend/.env contains:\n' +
      '  NEXT_PUBLIC_SUPABASE_URL=https://your-ref.supabase.co\n' +
      '  SUPABASE_SERVICE_ROLE_KEY=your-service-role-key\n'
  )
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

// ── Migrations tracking table ────────────────────────────────────
// We maintain a simple _migrations table in Supabase to track which
// SQL files have already been applied.
async function ensureMigrationsTable() {
  const { error } = await supabase.rpc('exec_sql', {
    sql: `
      CREATE TABLE IF NOT EXISTS _migrations (
        id          SERIAL PRIMARY KEY,
        filename    TEXT UNIQUE NOT NULL,
        applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `,
  })

  if (error) {
    // exec_sql RPC may not exist yet — fall back to direct REST approach
    // using the Supabase Management API isn't available in supabase-js,
    // so we check for the table existence differently below.
    if (error.message.includes('exec_sql')) {
      console.warn(
        '[Warning] exec_sql RPC not found. Migrations tracking disabled.\n' +
          'All migration files will be applied. Duplicate-safe SQL (IF NOT EXISTS) ensures idempotency.'
      )
      return false
    }
    throw new Error(`Could not create _migrations table: ${error.message}`)
  }
  return true
}

async function isApplied(filename: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('_migrations')
    .select('id')
    .eq('filename', filename)
    .maybeSingle()
  if (error) return false
  return data !== null
}

async function markApplied(filename: string) {
  await supabase.from('_migrations').insert({ filename })
}

// ── Apply a single SQL file via the Supabase REST /rpc ───────────
// NOTE: Supabase does not expose a direct SQL execution endpoint via
// the JS client. We use the pg REST interface via a custom RPC.
// If exec_sql is unavailable, we print the SQL and guide the user.
async function applySql(sql: string, filename: string, trackingEnabled: boolean) {
  const { error } = await supabase.rpc('exec_sql', { sql })

  if (error) {
    if (error.message.includes('exec_sql')) {
      // RPC doesn't exist — print SQL for manual application
      console.log(`\n── ${filename} ─────────────────────────────────────`)
      console.log(sql)
      console.log('─'.repeat(60))
      return false
    }
    throw new Error(`Migration ${filename} failed: ${error.message}`)
  }

  if (trackingEnabled) await markApplied(filename)
  return true
}

// ── Main ─────────────────────────────────────────────────────────
async function run() {
  console.log(`\n🚀 SIA Supabase Migration Runner`)
  console.log(`   Project: ${SUPABASE_URL}\n`)

  const migrationsDir = path.resolve(__dirname, '../../supabase/migrations')
  if (!fs.existsSync(migrationsDir)) {
    console.error(`[Error] Migrations directory not found: ${migrationsDir}`)
    process.exit(1)
  }

  const files = fs
    .readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort() // alphabetical = numerical order (001_, 002_, …)

  if (files.length === 0) {
    console.log('[Info] No migration files found.')
    return
  }

  const trackingEnabled = await ensureMigrationsTable()
  let applied = 0
  let skipped = 0
  let manual = 0

  for (const file of files) {
    if (trackingEnabled && (await isApplied(file))) {
      console.log(`  ⏭  ${file} — already applied, skipping`)
      skipped++
      continue
    }

    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8')
    console.log(`  ▶  Applying ${file} …`)

    const ok = await applySql(sql, file, trackingEnabled)
    if (ok) {
      console.log(`  ✅ ${file} — applied successfully`)
      applied++
    } else {
      console.log(`\n⚠️  exec_sql RPC not available on this Supabase project.`)
      console.log(
        `   The SQL above must be run manually in the Supabase SQL Editor:\n` +
          `   ${SUPABASE_URL.replace('.supabase.co', '')}.supabase.com/project/default/sql\n`
      )
      manual++
    }
  }

  console.log(
    `\n📊 Migration summary: ${applied} applied, ${skipped} skipped, ${manual} require manual execution\n`
  )

  if (manual > 0) {
    console.log(
      '💡 Tip: To enable automatic migration execution, create this RPC in your Supabase SQL Editor:\n\n' +
        "   CREATE OR REPLACE FUNCTION exec_sql(sql TEXT) RETURNS void\n" +
        "   LANGUAGE plpgsql SECURITY DEFINER AS $$\n" +
        "   BEGIN EXECUTE sql; END;\n" +
        "   $$;\n\n" +
        '   Then run: npm run migrate\n'
    )
  }
}

run().catch(err => {
  console.error('\n[Fatal]', err.message)
  process.exit(1)
})
