import 'server-only'
import { supabase } from './db'
import { config } from './config'

const SCHEMA_SQL = `
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

let _migrated = false

export async function migrate() {
  if (_migrated) return
  if (config.localDb) {
    console.log('✅ Local file storage active — no migration needed')
    _migrated = true
    return
  }

  const { error } = await supabase.from('projects').select('id').limit(1)
  if (error && (error.code === '42P01' || error.message.includes('does not exist'))) {
    console.error(`
[Migration Required] Table 'projects' not found in Supabase.
Please run the following SQL in your Supabase SQL Editor:

${SCHEMA_SQL}

Then restart the application.
`)
    throw new Error('Database migration required — see server logs')
  }
  if (error) throw new Error(`Migration check failed: ${error.message}`)
  console.log('✅ Database schema verified (Supabase)')
  _migrated = true
}
