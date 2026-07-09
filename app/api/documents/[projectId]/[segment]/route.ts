// DELETE /api/documents/:projectId/:docId  — removes a main-project document
import { NextRequest, NextResponse } from 'next/server'
import { loadProject, saveProject } from '@/lib/server/helpers'
import { deleteSiaGPTMedia } from '@/lib/server/siagpt'
import { requireProjectAuth } from '@/lib/server/auth'

export const runtime = 'nodejs'

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; segment: string }> }
) {
  const { projectId, segment: docId } = await params
  if (!await requireProjectAuth(request, projectId)) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  try {
    const project = await loadProject(projectId)
    if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    const doc = project.documents.find((d: any) => d.id === docId)
    if (doc?.siagptMediaId) await deleteSiaGPTMedia(doc.siagptMediaId)
    project.documents = project.documents.filter((d: any) => d.id !== docId)
    await saveProject(project)
    return NextResponse.json({ success: true })
  } catch (err: any) { return NextResponse.json({ error: err.message }, { status: 500 }) }
}
