// POST /api/ai/:projectId/:entityId/idi-choice — record whether the reviewer has documents to seed an IDI
// interview guide from. true keeps the idiGuide -> human interview -> idiSynth path gating external analysis
// (unchanged); false skips that path entirely so bench/pestel/marketSizing/competitor run straight off the
// entity's document collection. See setIdiDocumentsAvailable for the gating this flips.
import { NextRequest, NextResponse } from 'next/server'
import { loadProject, saveProject } from '@/lib/server/helpers'
import { requireProjectAuth } from '@/lib/server/auth'
import { resolveWave1Entity, setIdiDocumentsAvailable } from '@/lib/server/wave1Engine'

export const runtime = 'nodejs'
export const maxDuration = 30

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; entityId: string }> }
) {
  const { projectId, entityId } = await params
  if (!await requireProjectAuth(request, projectId)) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  try {
    const { hasDocuments } = await request.json()
    if (typeof hasDocuments !== 'boolean') return NextResponse.json({ error: 'hasDocuments must be a boolean' }, { status: 400 })

    const project = await loadProject(projectId)
    if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    const entity = resolveWave1Entity(project, entityId)
    if (!entity) return NextResponse.json({ error: 'Entity not found' }, { status: 404 })

    setIdiDocumentsAvailable(entity, hasDocuments)
    await saveProject(project)

    return NextResponse.json({ success: true, entityId, hasDocuments })
  } catch (err: any) { return NextResponse.json({ error: err.message }, { status: 400 }) }
}
