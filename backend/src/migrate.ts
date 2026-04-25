import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { supabase } from './db.js'
import { config } from './config.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const MIGRATIONS_DIR = path.resolve(__dirname, '../../supabase/migrations')

function loadMigrationSql(filename: string): string {
  const full = path.join(MIGRATIONS_DIR, filename)
  return fs.existsSync(full) ? fs.readFileSync(full, 'utf-8') : ''
}

const SCHEMA_SQL =
  loadMigrationSql('001_initial_schema.sql') ||
  `
CREATE TABLE IF NOT EXISTS projects (
  id            TEXT        PRIMARY KEY,
  name          TEXT        NOT NULL,
  entity_name   TEXT        NOT NULL,
  entity_type   TEXT,
  password_hash TEXT        NOT NULL,
  data          JSONB       NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_projects_updated_at ON projects (updated_at DESC);
`

export async function migrate() {
  if (config.localDb) {
    console.log('✅ Local file storage active — no migration needed')
    return
  }

  // Check whether the projects table exists
  const { error } = await supabase.from('projects').select('id').limit(1)

  if (error && (error.code === '42P01' || error.message.includes('does not exist'))) {
    console.error(`
╔══════════════════════════════════════════════════════════════╗
║  [Migration Required] Table 'projects' not found             ║
╚══════════════════════════════════════════════════════════════╝

Run one of the following options:

Option A — Automatic (recommended):
  cd backend/
  npm run migrate:run

Option B — Manual (Supabase SQL Editor):
  https://supabase.com/dashboard/project/roinirrknyxpkthtnujl/sql

  Paste and execute:
──────────────────────────────────────────────────────────────
${SCHEMA_SQL}
──────────────────────────────────────────────────────────────

Then restart the application.
`)
    process.exit(1)
  }

  if (error) {
    throw new Error(`Migration check failed: ${error.message}`)
  }

  console.log('✅ Database schema verified (Supabase)')
}
