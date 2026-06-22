import { NextRequest, NextResponse } from 'next/server'
import { requireProjectAuth } from '@/lib/server/auth'
import { getSiaGptToken } from '@/lib/server/siagpt'
import { config } from '@/lib/server/config'
import { log } from '@/lib/server/logger'

export const runtime = 'nodejs'

export async function POST(request: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  if (!await requireProjectAuth(request, projectId)) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  try {
    const { mediaVersionIds } = await request.json()
    if (!Array.isArray(mediaVersionIds) || !mediaVersionIds.length) return NextResponse.json([])
    if (!config.siagptBaseUrl) return NextResponse.json([])
    const token = await getSiaGptToken()
    const resp = await fetch(`${config.siagptBaseUrl}/medias/versions/sources/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'app-origin': 'AI Platform' },
      body: JSON.stringify(mediaVersionIds),
    })
    if (!resp.ok) { log.warn(`SiaGPT sources/batch failed: ${resp.status}`); return NextResponse.json([]) }
    return NextResponse.json(await resp.json())
  } catch (err: any) { return NextResponse.json({ error: err.message }, { status: 500 }) }
}
