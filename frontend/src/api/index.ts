import axios from 'axios'
import { CONFIG } from '../config'

const BASE_URL = CONFIG.API_URL

const api = axios.create({
  baseURL: `${BASE_URL}/api`,
  withCredentials: true,
  timeout: 60000,
})

api.interceptors.response.use(
  res => res,
  err => {
    if (err.response?.status === 401) {
      window.location.href = '/'
    }
    return Promise.reject(err)
  }
)

export const projectsApi = {
  list: () => api.get('/projects'),
  create: (data: any) => api.post('/projects', data),
  unlock: (id: string, password: string) => api.post(`/projects/${id}/unlock`, { password }),
  get: (id: string) => api.get(`/projects/${id}`),
  save: (id: string, data: any) => api.put(`/projects/${id}`, data),
  updatePillar: (id: string, pillarId: string, data: any) => api.patch(`/projects/${id}/pillar/${pillarId}`, data),
  updateStrategy: (id: string, data: any) => api.patch(`/projects/${id}/strategy`, data),
  delete: (id: string) => api.delete(`/projects/${id}`),
}

export const documentsApi = {
  upload: (projectId: string, files: File[], docType: string, docLabel: string) => {
    const formData = new FormData()
    files.forEach(f => formData.append('files', f))
    formData.append('docType', docType || 'general')
    formData.append('docLabel', docLabel || '')
    return api.post(`/documents/${projectId}/upload`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 120000,
    })
  },
  delete: (projectId: string, docId: string) => api.delete(`/documents/${projectId}/${docId}`),
  getText: (projectId: string, docId: string) => api.get(`/documents/${projectId}/${docId}/text`),
  embeddingStatus: (projectId: string) => api.get(`/documents/${projectId}/embedding-status`),
}

export const aiApi = {
  consolidateSwot: (projectId: string) => api.post(`/ai/${projectId}/consolidate-swot`),
  generateStrategy: (projectId: string, task: string, context: any) => api.post(`/ai/${projectId}/strategy/generate`, { task, context }),
  generateReport: (projectId: string, reportType: string) => api.post(`/ai/${projectId}/generate-report/${reportType}`),
  benchmarks: (projectId: string, pillarId: string) => api.post(`/ai/${projectId}/benchmarks/${pillarId}`),
  generateRubric: () => api.post('/rubric/generate'),
  getRubric: () => api.get('/rubric'),

  chat: async function* (projectId: string, messages: any[], context: any) {
    const resp = await fetch(`${BASE_URL}/api/ai/${projectId}/chat`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages, context }),
    })
    if (!resp.ok) { yield { error: `HTTP ${resp.status}` }; return }
    const reader = resp.body!.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed.startsWith('data: ')) continue
        try { yield JSON.parse(trimmed.slice(6)) } catch (e) {}
      }
    }
    if (buffer.trim().startsWith('data: ')) {
      try { yield JSON.parse(buffer.trim().slice(6)) } catch (e) {}
    }
  },

  assessPillarStream: async function* (projectId: string, pillarId: string) {
    const resp = await fetch(`${BASE_URL}/api/ai/${projectId}/assess/${pillarId}`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
    })
    if (!resp.ok) { yield { error: `HTTP ${resp.status}` }; return }
    const reader = resp.body!.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed.startsWith('data: ')) continue
        try { yield JSON.parse(trimmed.slice(6)) } catch (e) {}
      }
    }
    if (buffer.trim().startsWith('data: ')) {
      try { yield JSON.parse(buffer.trim().slice(6)) } catch (e) {}
    }
  },

  assessBatchStream: async function* (projectId: string, pillarIds: string[]) {
    const resp = await fetch(`${BASE_URL}/api/ai/${projectId}/assess-batch`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pillarIds }),
    })
    if (!resp.ok) { yield { error: `HTTP ${resp.status}` }; return }
    const reader = resp.body!.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed.startsWith('data: ')) continue
        try { yield JSON.parse(trimmed.slice(6)) } catch (e) {}
      }
    }
    if (buffer.trim().startsWith('data: ')) {
      try { yield JSON.parse(buffer.trim().slice(6)) } catch (e) {}
    }
  },
}

export const exportApi = {
  pdfUrl: (projectId: string, reportType: string) =>
    `${BASE_URL}/api/export/${projectId}/pdf/${reportType}`,
  pptxUrl: (projectId: string, reportType: string) =>
    `${BASE_URL}/api/export/${projectId}/pptx/${reportType}`,
}

export default api
