import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/server/db'
import { loadProject, saveProject } from '@/lib/server/helpers'
import { deleteSiaGPTCollection } from '@/lib/server/siagpt'
import { requireProjectAuth } from '@/lib/server/auth'

export const runtime = 'nodejs'
export const maxDuration = 30

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!await requireProjectAuth(request, id)) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  try {
    const project = await loadProject(id)
    if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const { passwordHash, ...safe } = project
    return NextResponse.json(safe)
  } catch (err: any) { return NextResponse.json({ error: err.message }, { status: 500 }) }
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!await requireProjectAuth(request, id)) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  try {
    const existing = await loadProject(id)
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const body = await request.json()
    const updated = { ...existing, ...body, id: existing.id, passwordHash: existing.passwordHash }
    await saveProject(updated)
    return NextResponse.json({ success: true })
  } catch (err: any) { return NextResponse.json({ error: err.message }, { status: 500 }) }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!await requireProjectAuth(request, id)) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  try {
    const project = await loadProject(id)
    if (project) {
      const collectionIds: string[] = []
      if (project.siagptCollectionId) collectionIds.push(project.siagptCollectionId)
      for (const entity of (project.entities || [])) {
        if (entity.siagptCollectionId) collectionIds.push(entity.siagptCollectionId)
      }
      await Promise.allSettled(collectionIds.map(cid => deleteSiaGPTCollection(cid)))
    }
    await supabase.from('projects').delete().eq('id', id)
    return NextResponse.json({ success: true })
  } catch (err: any) { return NextResponse.json({ error: err.message }, { status: 500 }) }
}
