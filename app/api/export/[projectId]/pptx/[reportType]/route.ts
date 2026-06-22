import { NextRequest, NextResponse } from 'next/server'
import { loadProject } from '@/lib/server/helpers'
import { requireProjectAuth } from '@/lib/server/auth'

export const runtime = 'nodejs'
export const maxDuration = 60

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; reportType: string }> }
) {
  const { projectId, reportType } = await params
  if (!await requireProjectAuth(request, projectId)) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  try {
    const project = await loadProject(projectId)
    if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const output = project.outputs[reportType]
    if (!output?.content) return NextResponse.json({ error: 'Report not generated yet. Generate the report first.' }, { status: 400 })
    const { generatePptx } = await import('@/services/pptxExport')
    const pptxBuffer = await generatePptx(project, reportType, output.content)
    const filename = `${project.entityName.replace(/\s+/g,'_')}_${reportType}_${new Date().toISOString().split('T')[0]}.pptx`
    return new Response(pptxBuffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'Content-Disposition': `attachment; filename="${filename}"`,
      }
    })
  } catch (err: any) { return NextResponse.json({ error: err.message }, { status: 500 }) }
}
