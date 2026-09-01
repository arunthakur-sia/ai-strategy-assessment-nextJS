// PATCH /api/ai/:projectId/:entityId/agent/:agentId/score — set (or clear) the reviewer's manual override
// score for a pillar agent (P1-P8). Unlike approval, this isn't gated by chat/lock state — a reviewer can
// set it at any time — and it immediately becomes finalScore, the field every other score display in the
// app reads, taking precedence over the agent's own aiScore.
import { NextRequest, NextResponse } from 'next/server'
import { loadProject, saveProject } from '@/lib/server/helpers'
import { requireProjectAuth } from '@/lib/server/auth'
import { resolveWave1Entity, setWave1ManualScore } from '@/lib/server/wave1Engine'

export const runtime = 'nodejs'
export const maxDuration = 30

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; entityId: string; agentId: string }> }
) {
  const { projectId, entityId, agentId } = await params
  if (!await requireProjectAuth(request, projectId)) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  try {
    const { manualScore } = await request.json()
    if (manualScore !== null && (typeof manualScore !== 'number' || isNaN(manualScore) || manualScore < 1 || manualScore > 5)) {
      return NextResponse.json({ error: 'manualScore must be a number between 1 and 5, or null' }, { status: 400 })
    }

    const project = await loadProject(projectId)
    if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    const entity = resolveWave1Entity(project, entityId)
    if (!entity) return NextResponse.json({ error: 'Entity not found' }, { status: 404 })

    setWave1ManualScore(entity, agentId, manualScore)
    await saveProject(project)

    return NextResponse.json({ success: true, entityId, agentId, manualScore })
  } catch (err: any) { return NextResponse.json({ error: err.message }, { status: 400 }) }
}
