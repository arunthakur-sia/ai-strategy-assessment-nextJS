// Ensure all .env vars are loaded regardless of tsx/Node version support for --env-file
import { readFileSync } from 'fs'
import { resolve } from 'path'
try {
  const lines = readFileSync(resolve(process.cwd(), '.env'), 'utf8').split('\n')
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIdx = trimmed.indexOf('=')
    if (eqIdx < 1) continue
    const key = trimmed.slice(0, eqIdx).trim()
    let val = trimmed.slice(eqIdx + 1).trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1)
    if (!process.env[key]) process.env[key] = val
  }
} catch { /* no .env file — rely on system environment */ }

function parseOrigins(input: string): string[] {
  return input
    .split(',')
    .map(v => v.trim().replace(/\/+$/, ''))
    .filter(Boolean)
}

const configuredOrigins = parseOrigins(
  process.env.CORS_ORIGINS || process.env.FRONTEND_URL || 'http://localhost:5173'
)

export const config = {
  port: parseInt(process.env.PORT || '3001', 10),
  sessionSecret: process.env.SESSION_SECRET || 'sia-dev-secret-change-in-production',
  nodeEnv: process.env.NODE_ENV || 'development',
  frontendUrl: configuredOrigins[0] || 'http://localhost:5173',
  frontendOrigins: configuredOrigins,
  // Supabase
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '',
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  // Local file-based DB fallback (activated via LOCAL_DB=true or missing supabase creds)
  localDb: process.env.LOCAL_DB === 'true' || !process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY,
  // SiaGPT (Claude backend)
  siagptBaseUrl: process.env.SIAGPT_BASE_URL || 'https://backend.siagpt.ai',
  siagptProjectId: process.env.SIAGPT_PROJECT_ID || process.env.NEXT_PUBLIC_SIAGPT_PROJECT_ID || '',
  oauth2TokenUrl: process.env.OAUTH2_TOKEN_URL || '',
  oauth2ClientId: process.env.OAUTH2_CLIENT_ID || '',
  oauth2ClientSecret: process.env.OAUTH2_CLIENT_SECRET || '',
  zitadelProjectId: process.env.ZITADEL_PROJECT_ID || '',
  siagptAssistantId: process.env.SIAGPT_ASSISTANT_ID || '',
  siagptBundleId: process.env.SIAGPT_BUNDLE_ID || '',
  // Static bearer token (overrides OAuth2 when set — dev only)
  siagptBearerToken: process.env.SIAGPT_BEARER_TOKEN || '',
  // Folder ID in SiaGPT medias service where project collections are stored
  siagptMediaFolderId: process.env.SIAGPT_MEDIA_FOLDER_ID || '',
  // Owner ID (USER) used as ownerId in SiaGPT discussion/message calls
  siagptOwnerId: process.env.SIAGPT_OWNER_ID || '019cd318-5f66-7f23-a114-3400179bc75c',
  // Per-pillar assistant IDs — each pillar has its own configured SiaGPT agent
  pillarAssistantIds: {
    P1: process.env.SIAGPT_ASSISTANT_P1 || process.env.NEXT_PUBLIC_ASSISTANT_PILLAR_1 || '',
    P2: process.env.SIAGPT_ASSISTANT_P2 || process.env.NEXT_PUBLIC_ASSISTANT_PILLAR_2 || '',
    P3: process.env.SIAGPT_ASSISTANT_P3 || process.env.NEXT_PUBLIC_ASSISTANT_PILLAR_3 || '',
    P4: process.env.SIAGPT_ASSISTANT_P4 || process.env.NEXT_PUBLIC_ASSISTANT_PILLAR_4 || '',
    P5: process.env.SIAGPT_ASSISTANT_P5 || process.env.NEXT_PUBLIC_ASSISTANT_PILLAR_5 || '',
    P6: process.env.SIAGPT_ASSISTANT_P6 || process.env.NEXT_PUBLIC_ASSISTANT_PILLAR_6 || '',
    P7: process.env.SIAGPT_ASSISTANT_P7 || process.env.NEXT_PUBLIC_ASSISTANT_PILLAR_7 || '',
    P8: process.env.SIAGPT_ASSISTANT_P8 || process.env.NEXT_PUBLIC_ASSISTANT_PILLAR_8 || '',
  } as Record<string, string>,
  // Non-pillar agent assistant IDs
  assistantIds: {
    swot:     process.env.SIAGPT_ASSISTANT_SWOT     || '',
    strategy: process.env.SIAGPT_ASSISTANT_STRATEGY || '',
    chat:     process.env.SIAGPT_ASSISTANT_CHAT     || '',
    d1:       process.env.SIAGPT_ASSISTANT_D1       || '',
    d2:       process.env.SIAGPT_ASSISTANT_D2       || '',
    d3:       process.env.SIAGPT_ASSISTANT_D3       || '',
    d4:       process.env.SIAGPT_ASSISTANT_D4       || '',
    d5:       process.env.SIAGPT_ASSISTANT_D5       || '',
    d6:       process.env.SIAGPT_ASSISTANT_D6       || '',
    rubric:   process.env.SIAGPT_ASSISTANT_RUBRIC   || '',
  } as Record<string, string>,
  isDev: (process.env.NODE_ENV || 'development') === 'development',
}
