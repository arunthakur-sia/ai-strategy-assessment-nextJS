// GET /api/documents/:projectId/:entityId/embedding-status
import { NextRequest, NextResponse } from 'next/server'
import { loadProject } from '@/lib/server/helpers'
import { getSiaGptToken } from '@/lib/server/siagpt'
import { requireProjectAuth } from '@/lib/server/auth'
import { config } from '@/lib/server/config'

export const runtime = 'nodejs'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; segment: string }> }
) {
  const { projectId, segment: entityId } = await params
  if (!await requireProjectAuth(request, projectId)) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  try {
    const project = await loadProject(projectId)
    if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    const entity = (project.entities || []).find((e: any) => e.id === entityId)
    if (!entity) return NextResponse.json({ error: 'Entity not found' }, { status: 404 })
    if (!entity.siagptCollectionId) {
      const status: Record<string, number> = {}
      for (const doc of entity.documents) status[doc.name] = 1.0
      return NextResponse.json({ status })
    }
    const token = await getSiaGptToken()
    const resp = await fetch(`${config.siagptBaseUrl}/medias/collections/${entity.siagptCollectionId}?get_medias=true`, {
      headers: { Authorization: `Bearer ${token}`, 'app-origin': 'AI Platform' },
    })
    if (!resp.ok) return NextResponse.json({ status: {} })
    const data = await resp.json() as any
    const medias: any[] = data.medias || []
    const status: Record<string, number> = {}
    for (const media of medias) {
      if (media.name) status[media.name] = typeof media.completion === 'number' ? media.completion : 0
    }
    return NextResponse.json({ status })
  } catch (err: any) { return NextResponse.json({ error: err.message }, { status: 500 }) }
}
