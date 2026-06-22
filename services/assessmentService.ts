/**
 * assessmentService.ts
 *
 * Module-level assessment service. All SSE stream Promises are stored at module
 * scope, so they are NEVER garbage-collected or cancelled by React component
 * lifecycle events (unmount, navigation, etc.). Components call the exported
 * functions and optionally pass callbacks for live UI updates while they are
 * mounted; if the component unmounts before the stream finishes the callbacks
 * become no-ops but the stream and the Zustand store updates continue.
 */

import { aiApi, projectsApi } from '@/lib/api'
import { useStore } from '@/store/useStore'

// ─── module-level reference counter ───────────────────────────────────────────
let _running = 0

function _inc() {
  _running++
  useStore.getState().setAssessmentRunning(true)
}

function _dec() {
  _running = Math.max(0, _running - 1)
  if (_running === 0) {
    useStore.getState().setAssessmentRunning(false)
    useStore.getState().setAssessmentRunningPillars({})
  }
}

// ─── active stream holders ────────────────────────────────────────────────────
// Stored at module scope so they can never be GC'd by React
const _pillarStreams = new Map<string, Promise<void>>()     // key = `${projectId}:${scope}:${pillarId}`
let _batchStream: Promise<void> | null = null
let _entitiesStream: Promise<void> | null = null

// ─── single pillar ────────────────────────────────────────────────────────────
export interface PillarAssessmentCallbacks {
  onChunk?: (text: string) => void
  onDone?: () => void
  onError?: (err: string) => void
}

export function startPillarAssessment(
  projectId: string,
  entityId: string | null,
  pillarId: string,
  cbs?: PillarAssessmentCallbacks,
): void {
  const key = `${projectId}:${entityId ?? '__main__'}:${pillarId}`
  if (_pillarStreams.has(key)) return // already in flight

  _inc()

  const p: Promise<void> = (async () => {
    try {
      const stream = entityId
        ? aiApi.assessEntityPillarStream(projectId, entityId, pillarId)
        : aiApi.assessPillarStream(projectId, pillarId)

      for await (const data of stream) {
        if (data.chunk) cbs?.onChunk?.(data.chunk)
        if (data.done) {
          const res = await projectsApi.get(projectId)
          useStore.getState().setProject(res.data)
          cbs?.onDone?.()
        }
        if (data.error) {
          cbs?.onError?.(data.error)
          break
        }
      }
    } catch (e: any) {
      cbs?.onError?.(e?.message ?? 'Assessment failed')
    } finally {
      _pillarStreams.delete(key)
      _dec()
    }
  })()

  _pillarStreams.set(key, p)
}

// ─── batch assessment ─────────────────────────────────────────────────────────
export interface BatchAssessmentCallbacks {
  onPillarUpdate?: (pillarId: string, status: 'done' | 'error') => void
  onDone?: (failedIds: string[]) => void
  onError?: (err: string) => void
}

export function startBatchAssessment(
  projectId: string,
  entityId: string | null,
  pillarIds: string[],
  cbs?: BatchAssessmentCallbacks,
): void {
  if (_batchStream) return // already in flight
  if (pillarIds.length === 0) return

  // Set initial per-pillar running state in Zustand
  const initial: Record<string, 'running' | 'done' | 'error'> = {}
  pillarIds.forEach(id => { initial[id] = 'running' })
  useStore.getState().setAssessmentRunningPillars(initial)

  _inc()

  _batchStream = (async () => {
    try {
      const stream = entityId
        ? aiApi.assessEntityBatchStream(projectId, entityId, pillarIds)
        : aiApi.assessBatchStream(projectId, pillarIds)

      for await (const data of stream) {
        if (data.pillarId && data.progress) {
          useStore.getState().updateAssessmentRunningPillar(data.pillarId, 'done')
          cbs?.onPillarUpdate?.(data.pillarId, 'done')
        }
        if (data.pillarId && data.error) {
          useStore.getState().updateAssessmentRunningPillar(data.pillarId, 'error')
          cbs?.onPillarUpdate?.(data.pillarId, 'error')
        }
        if (data.done) {
          const res = await projectsApi.get(projectId)
          useStore.getState().setProject(res.data)
          cbs?.onDone?.(data.failedPillarIds || [])
        }
        if (data.error && !data.pillarId) {
          cbs?.onError?.(data.error)
        }
      }
    } catch (e: any) {
      cbs?.onError?.(e?.message ?? 'Batch assessment failed')
    } finally {
      _batchStream = null
      _dec()
    }
  })()
}

// ─── all-entities assessment ──────────────────────────────────────────────────
export interface EntitiesAssessmentCallbacks {
  onEntityPillarProgress?: (entityId: string, pillarId: string, status: 'done' | 'error') => void
  onDone?: () => void
  onError?: (err: string) => void
}

export function startEntitiesAssessment(
  projectId: string,
  entityIds: string[],
  cbs?: EntitiesAssessmentCallbacks,
): void {
  if (_entitiesStream) return // already in flight
  if (entityIds.length === 0) return

  _inc()

  _entitiesStream = (async () => {
    try {
      for await (const data of aiApi.assessEntitiesStream(projectId, entityIds)) {
        if (data.entityId && data.pillarId && data.progress) {
          cbs?.onEntityPillarProgress?.(data.entityId, data.pillarId, 'done')
        }
        if (data.entityId && data.pillarId && data.error) {
          cbs?.onEntityPillarProgress?.(data.entityId, data.pillarId, 'error')
        }
        if (data.done) {
          const res = await projectsApi.get(projectId)
          useStore.getState().setProject(res.data)
          cbs?.onDone?.()
        }
        if (data.error && !data.entityId) {
          cbs?.onError?.(data.error)
        }
      }
    } catch (e: any) {
      cbs?.onError?.(e?.message ?? 'Entities assessment failed')
    } finally {
      _entitiesStream = null
      _dec()
    }
  })()
}

/** True if any stream is currently active */
export function isAssessmentRunning(): boolean {
  return _running > 0
}
