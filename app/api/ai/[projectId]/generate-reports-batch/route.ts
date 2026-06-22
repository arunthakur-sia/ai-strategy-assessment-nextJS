import { NextRequest } from 'next/server'
import { loadProject, saveProject, defaultOutputs } from '@/lib/server/helpers'
import { callSiaGPT } from '@/lib/server/siagpt'
import { requireProjectAuth } from '@/lib/server/auth'
import { config } from '@/lib/server/config'
import { buildReportPrompts, cleanReportContent } from '@/lib/server/prompts'
import { createSSEStream } from '@/lib/server/sse'

export const runtime = 'nodejs'
export const maxDuration = 720

export async function POST(request: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  if (!await requireProjectAuth(request, projectId)) {
    return createSSEStream(async (send, close) => { send({ error: 'Not authenticated' }); close() })
  }

  const body = await request.json().catch(() => ({}))

  return createSSEStream(async (send, close) => {
    let heartbeat: NodeJS.Timeout | null = null
    try {
      heartbeat = setInterval(() => { try { send({ heartbeat: true }) } catch { /* ignore */ } }, 15000)

      const project = await loadProject(projectId)
      if (!project) { send({ error: 'Project not found' }); clearInterval(heartbeat!); return close() }

      const { entityIds, reportTypes } = body as { entityIds: string[], reportTypes: string[] }
      if (!Array.isArray(entityIds) || !entityIds.length || !Array.isArray(reportTypes) || !reportTypes.length) {
        send({ error: 'entityIds and reportTypes arrays are required' }); clearInterval(heartbeat!); return close()
      }

      const validReportTypes = ['D1','D2','D3','D4','D5','D6']
      const resolvedTypes = reportTypes.filter(t => validReportTypes.includes(t))

      type Task = { entityId: string; entityName: string; entityType: string; pillarsData: any; swotData: any; outputsStore: any }
      const tasks: Task[] = []
      for (const eid of entityIds) {
        if (eid === '__main__') {
          tasks.push({ entityId: '__main__', entityName: project.entityName, entityType: project.entityType, pillarsData: project.assessment.pillars, swotData: project.assessment.consolidatedSwot, outputsStore: project.outputs })
        } else {
          const entity = (project.entities || []).find((e: any) => e.id === eid)
          if (!entity) continue
          if (!entity.outputs) entity.outputs = defaultOutputs()
          tasks.push({ entityId: entity.id, entityName: entity.name, entityType: entity.type || project.entityType, pillarsData: entity.assessment.pillars, swotData: entity.assessment.consolidatedSwot, outputsStore: entity.outputs })
        }
      }

      let succeeded = 0, failed = 0
      const total = tasks.length * resolvedTypes.length

      await Promise.allSettled(
        tasks.flatMap(task =>
          resolvedTypes.map(reportType => async () => {
            send({ entityId: task.entityId, entityName: task.entityName, reportType, status: 'started' })
            try {
              const prompts = buildReportPrompts(task.entityName, task.entityType, task.pillarsData, task.swotData)
              const result = await callSiaGPT(prompts[reportType], {
                assistantId: config.assistantIds[reportType.toLowerCase()],
                tools: [],
                context: `batch generate report ${reportType} for ${task.entityName}`,
                timeoutMs: 12 * 60 * 1000,
              })
              const content = cleanReportContent(result.text)
              task.outputsStore[reportType] = { generated: true, content, lastGenerated: new Date().toISOString() }
              succeeded++
              send({ entityId: task.entityId, entityName: task.entityName, reportType, status: 'done', content })
            } catch (err: any) {
              failed++
              send({ entityId: task.entityId, entityName: task.entityName, reportType, status: 'error', error: err.message })
            }
          })
        ).map(job => job())
      )

      await saveProject(project)
      clearInterval(heartbeat!)
      send({ batchDone: true, total, succeeded, failed })
      close()
    } catch (err: any) {
      if (heartbeat) clearInterval(heartbeat)
      send({ error: err.message }); close()
    }
  })
}
