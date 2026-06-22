// GET /api/documents/:projectId/:docId/text
import { NextRequest, NextResponse } from 'next/server'
import { loadProject } from '@/lib/server/helpers'
import { requireProjectAuth } from '@/lib/server/auth'

export const runtime = 'nodejs'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; segment: string }> }
) {
  const { projectId, segment: docId } = await params
  if (!await requireProjectAuth(request, projectId)) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  try {
    const project = await loadProject(projectId)
    if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    const doc = project.documents.find((d: any) => d.id === docId)
    if (!doc) return NextResponse.json({ error: 'Document not found' }, { status: 404 })
    return NextResponse.json({ text: doc.extractedText, name: doc.name })
  } catch (err: any) { return NextResponse.json({ error: err.message }, { status: 500 }) }
}
