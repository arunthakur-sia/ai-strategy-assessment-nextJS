import { NextRequest, NextResponse } from 'next/server'
import { requireProjectAuth } from '@/lib/server/auth'
import { getSiaGptToken } from '@/lib/server/siagpt'
import { config } from '@/lib/server/config'
import { log } from '@/lib/server/logger'

export const runtime = 'nodejs'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; mediaVersionId: string }> }
) {
  const { projectId, mediaVersionId } = await params
  if (!await requireProjectAuth(request, projectId)) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  try {
    if (!config.siagptBaseUrl) return NextResponse.json({ error: 'Unavailable' }, { status: 503 })
    const token = await getSiaGptToken()
    const batchResp = await fetch(`${config.siagptBaseUrl}/medias/versions/sources/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'app-origin': 'AI Platform' },
      body: JSON.stringify([mediaVersionId]),
    })
    if (!batchResp.ok) return NextResponse.json({ error: 'Failed to resolve source' }, { status: 502 })
    const batchData = await batchResp.json() as any[]
    const item = batchData.find((i: any) => i?.uuid === mediaVersionId) || batchData[0]
    if (item?.path) {
      const s3Resp = await fetch(item.path)
      if (!s3Resp.ok) return NextResponse.json({ error: 'Failed to fetch document' }, { status: 502 })
      const contentType = s3Resp.headers.get('content-type') || 'application/octet-stream'
      const contentLength = s3Resp.headers.get('content-length')
      const filename = item.name ? encodeURIComponent(item.name) : 'document'
      const headers: Record<string, string> = {
        'Content-Type': contentType,
        'Content-Disposition': `inline; filename*=UTF-8''${filename}`,
      }
      if (contentLength) headers['Content-Length'] = contentLength
      return new Response(s3Resp.body, { headers })
    } else if (item?.externalLink) {
      return NextResponse.redirect(item.externalLink, 302)
    } else {
      return NextResponse.json({ error: 'Source not found' }, { status: 404 })
    }
  } catch (err: any) { log.error('sources/view error', err); return NextResponse.json({ error: err.message }, { status: 500 }) }
}
