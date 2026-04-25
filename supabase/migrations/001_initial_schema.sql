-- ============================================================
-- SIA Strategy Assessment — Supabase Initial Migration
-- Run this in: Supabase Dashboard → SQL Editor → New Query
-- Project: https://roinirrknyxpkthtnujl.supabase.co
-- ============================================================

-- ─── Projects table ─────────────────────────────────────────────
-- Stores the full project state as a JSONB blob alongside indexed
-- columns for efficient listing and filtering.
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

-- Index for the listing query (ORDER BY updated_at DESC)
CREATE INDEX IF NOT EXISTS idx_projects_updated_at
  ON projects (updated_at DESC);

-- Index for entity_type filtering (optional future use)
CREATE INDEX IF NOT EXISTS idx_projects_entity_type
  ON projects (entity_type);

-- ─── Auto-update updated_at on row changes ───────────────────────
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_projects_updated_at ON projects;
CREATE TRIGGER trg_projects_updated_at
  BEFORE UPDATE ON projects
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── Row Level Security ──────────────────────────────────────────
-- The backend always uses the service-role key (bypasses RLS).
-- RLS is enabled as a defence-in-depth measure; the anon key
-- cannot read or write project data directly.
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;

-- Service-role bypasses all policies automatically (no policy needed).
-- Deny all access via the anon / authenticated roles by default.
-- (No permissive policies are created, so the default is DENY.)
