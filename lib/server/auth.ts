import 'server-only'
import crypto from 'crypto'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import { config } from './config'

const TOKEN_TTL_MS = 8 * 60 * 60 * 1000

export function generateProjectToken(projectId: string): string {
  const expires = (Date.now() + TOKEN_TTL_MS).toString(36)
  const payload = Buffer.from(`${projectId}|${expires}`).toString('base64url')
  const sig = crypto.createHmac('sha256', config.sessionSecret).update(payload).digest('base64url')
  return `${payload}.${sig}`
}

export function verifyProjectToken(token: string, expectedProjectId: string): boolean {
  const dot = token.lastIndexOf('.')
  if (dot === -1) return false
  const payload = token.slice(0, dot)
  const sig = token.slice(dot + 1)
  const expectedSig = crypto.createHmac('sha256', config.sessionSecret).update(payload).digest('base64url')
  if (sig !== expectedSig) return false
  let decoded: string
  try { decoded = Buffer.from(payload, 'base64url').toString() } catch { return false }
  const pipe = decoded.indexOf('|')
  if (pipe === -1) return false
  return decoded.slice(0, pipe) === expectedProjectId && Date.now() < parseInt(decoded.slice(pipe + 1), 36)
}

// ── Cookie session helpers ─────────────────────────────────────────────────────

const SESSION_COOKIE = 'sia_session'

function signSession(data: string): string {
  const sig = crypto.createHmac('sha256', config.sessionSecret).update(data).digest('base64url')
  return `${sig}.${data}`
}

function verifySession(cookie: string): { unlockedProjects: string[] } | null {
  const dot = cookie.indexOf('.')
  if (dot === -1) return null
  const sig = cookie.slice(0, dot)
  const data = cookie.slice(dot + 1)
  const expectedSig = crypto.createHmac('sha256', config.sessionSecret).update(data).digest('base64url')
  if (sig !== expectedSig) return null
  try { return JSON.parse(data) } catch { return null }
}

export async function getSession(): Promise<{ unlockedProjects: string[] }> {
  const cookieStore = await cookies()
  const raw = cookieStore.get(SESSION_COOKIE)?.value
  if (!raw) return { unlockedProjects: [] }
  return verifySession(raw) ?? { unlockedProjects: [] }
}

export function setSessionCookie(
  response: NextResponse,
  session: { unlockedProjects: string[] }
): void {
  const data = JSON.stringify(session)
  const signed = signSession(data)
  response.cookies.set(SESSION_COOKIE, signed, {
    httpOnly: true,
    secure: config.nodeEnv === 'production',
    maxAge: 8 * 60 * 60,
    sameSite: config.nodeEnv === 'production' ? 'none' : 'lax',
    path: '/',
  })
}

// Reads projectId from the request and verifies auth via bearer token or session cookie.
// Returns the projectId if authed, null otherwise.
export async function requireProjectAuth(
  req: NextRequest,
  projectId: string
): Promise<boolean> {
  const auth = req.headers.get('authorization')
  if (auth?.startsWith('Bearer ') && verifyProjectToken(auth.slice(7), projectId)) {
    return true
  }
  const session = await getSession()
  return session.unlockedProjects.includes(projectId)
}
