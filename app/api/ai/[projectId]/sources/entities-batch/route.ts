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
    const { entityIds } = await request.json()
    if (!Array.isArray(entityIds) || !entityIds.length) return NextResponse.json([])
    if (!config.siagptBaseUrl) return NextResponse.json([])
    const token = await getSiaGptToken()

    const entityResults = await Promise.allSettled(
      entityIds.map(async (id: string) => {
        const r = await fetch(`${config.siagptBaseUrl}/medias/entities/${encodeURIComponent(id)}`, {
          headers: { Authorization: `Bearer ${token}`, 'app-origin': 'AI Platform' },
        })
        if (!r.ok) return null
        const d = await r.json() as Record<string, any>
        return { uuid: id, name: (d.fileName as string) || (d.name as string) || id, externalLink: (d.externalLink as string) || null, mediaVersionId: (d.mediaVersionId as string) || null }
      })
    )
    const entities = entityResults.filter(r => r.status === 'fulfilled' && r.value).map(r => (r as PromiseFulfilledResult<any>).value)

    const mvIds: string[] = Array.from(new Set(entities.map((e: any) => e.mediaVersionId).filter(Boolean)))
    const versionMeta: Record<string, any> = {}
    if (mvIds.length > 0) {
      try {
        const mvResp = await fetch(`${config.siagptBaseUrl}/medias/versions/sources/batch`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'app-origin': 'AI Platform' },
          body: JSON.stringify(mvIds),
        })
        if (mvResp.ok) {
          const mvData = await mvResp.json() as any[]
          for (const v of mvData) { if (v?.uuid) versionMeta[v.uuid] = v }
        }
      } catch { /* non-fatal */ }
    }

    const merged = entities.map((e: any) => {
      const vm = e.mediaVersionId ? versionMeta[e.mediaVersionId] : null
      return { uuid: e.uuid, name: e.name, summary: vm?.summary || null, path: vm?.path || null, externalLink: e.externalLink || vm?.externalLink || null, mediaVersionId: e.mediaVersionId }
    })
    return NextResponse.json(merged)
  } catch (err: any) { return NextResponse.json({ error: err.message }, { status: 500 }) }
}
