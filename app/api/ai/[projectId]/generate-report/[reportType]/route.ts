import { NextRequest } from 'next/server'
import { loadProject, saveProject } from '@/lib/server/helpers'
import { callSiaGPT } from '@/lib/server/siagpt'
import { requireProjectAuth } from '@/lib/server/auth'
import { config } from '@/lib/server/config'
import { buildReportPrompts, cleanReportContent } from '@/lib/server/prompts'
import { createSSEStream } from '@/lib/server/sse'
import { defaultOutputs } from '@/lib/server/helpers'

export const runtime = 'nodejs'
export const maxDuration = 720

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; reportType: string }> }
) {
  const { projectId, reportType } = await params
  if (!await requireProjectAuth(request, projectId)) {
    return createSSEStream(async (send, close) => { send({ error: 'Not authenticated' }); close() })
  }

  const body = await request.json().catch(() => ({}))

  return createSSEStream(async (send, close) => {
    let heartbeat: NodeJS.Timeout | null = null
    try {
      const encoder = new TextEncoder()
      // Raw heartbeat comment — send directly without the data: prefix
      heartbeat = setInterval(() => {
        try { send({ heartbeat: true }) } catch { /* ignore */ }
      }, 15000)

      const project = await loadProject(projectId)
      if (!project) { send({ error: 'Project not found' }); clearInterval(heartbeat!); return close() }

      const entityId: string | undefined = body?.entityId
      let entityName: string, entityType: string, pillarsData: any, swotData: any, outputsStore: any

      if (entityId && entityId !== '__main__') {
        const entity = (project.entities || []).find((e: any) => e.id === entityId)
        if (!entity) { send({ error: 'Entity not found' }); clearInterval(heartbeat!); return close() }
        entityName = entity.name
        entityType = entity.type || project.entityType
        pillarsData = entity.assessment.pillars
        swotData = entity.assessment.consolidatedSwot
        if (!entity.outputs) entity.outputs = defaultOutputs()
        outputsStore = entity.outputs
      } else {
        entityName = project.entityName
        entityType = project.entityType
        pillarsData = project.assessment.pillars
        swotData = project.assessment.consolidatedSwot
        outputsStore = project.outputs
      }

      const prompts = buildReportPrompts(entityName, entityType, pillarsData, swotData)
      const prompt = prompts[reportType]
      if (!prompt) { send({ error: 'Unknown report type' }); clearInterval(heartbeat!); return close() }

      send({ progress: true, message: `Generating ${reportType} report as markdown…` })
      const reportResult = await callSiaGPT(prompt, {
        assistantId: config.assistantIds[reportType.toLowerCase()],
        tools: [],
        context: `generate report ${reportType}`,
        timeoutMs: 12 * 60 * 1000,
      })

      const content = cleanReportContent(reportResult.text)
      outputsStore[reportType] = { generated: true, content, lastGenerated: new Date().toISOString() }
      await saveProject(project)
      clearInterval(heartbeat!)
      send({ done: true, content })
      close()
    } catch (err: any) {
      if (heartbeat) clearInterval(heartbeat)
      send({ error: err.message }); close()
    }
  })
}
