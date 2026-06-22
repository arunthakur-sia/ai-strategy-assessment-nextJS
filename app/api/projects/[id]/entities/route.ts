import { NextRequest, NextResponse } from 'next/server'
import { loadProject, saveProject, createDefaultEntity } from '@/lib/server/helpers'
import { createSiaGPTCollection } from '@/lib/server/siagpt'
import { requireProjectAuth } from '@/lib/server/auth'
import { config } from '@/lib/server/config'

export const runtime = 'nodejs'
export const maxDuration = 30

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!await requireProjectAuth(request, id)) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  try {
    const project = await loadProject(id)
    if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    const { name, type } = await request.json()
    if (!name) return NextResponse.json({ error: 'Entity name required' }, { status: 400 })

    const entity = createDefaultEntity(name, type || 'corporate')
    if (config.siagptMediaFolderId) {
      const collId = await createSiaGPTCollection(name, `SIA Partners strategy assessment collection for ${name}`)
      if (!collId) {
        return NextResponse.json({
          error: `Failed to create SiaGPT document collection for "${name}". Please retry.`,
          retryable: true,
        }, { status: 503 })
      }
      entity.siagptCollectionId = collId
    }

    if (!project.entities) project.entities = []
    project.entities.push(entity)
    await saveProject(project)
    return NextResponse.json({ success: true, entity: { id: entity.id, name: entity.name, type: entity.type, siagptCollectionId: entity.siagptCollectionId } })
  } catch (err: any) { return NextResponse.json({ error: err.message }, { status: 500 }) }
}
