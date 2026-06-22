import { NextRequest, NextResponse } from 'next/server'
import { loadProject, saveProject } from '@/lib/server/helpers'
import { requireProjectAuth } from '@/lib/server/auth'

export const runtime = 'nodejs'

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; entityId: string }> }
) {
  const { id, entityId } = await params
  if (!await requireProjectAuth(request, id)) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  try {
    const project = await loadProject(id)
    if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const entity = (project.entities || []).find((e: any) => e.id === entityId)
    if (!entity) return NextResponse.json({ error: 'Entity not found' }, { status: 404 })
    const body = await request.json()
    const defaultStrategy = { template: 'government', levelNames: ['Vision', 'Strategic Option', 'Outcome', 'Initiative'], nodes: [] }
    entity.strategy = { ...(entity.strategy || defaultStrategy), ...body }
    await saveProject(project)
    return NextResponse.json({ success: true })
  } catch (err: any) { return NextResponse.json({ error: err.message }, { status: 500 }) }
}
