import 'server-only'
import { config } from './config'
import { log } from './logger'

let _cachedSiaGptToken: string | undefined
let _tokenFetchInFlight: Promise<string> | undefined
let _staticBearerInvalidated = false

export interface SiaGPTResult {
  text: string
  newSources: Record<string, { id: string; type: string; url?: string; header?: string; description?: string }>
  fileUrl?: string
  fileName?: string
}

export async function getSiaGptToken(): Promise<string> {
  if (_cachedSiaGptToken) return _cachedSiaGptToken
  if (_tokenFetchInFlight) return _tokenFetchInFlight
  if (config.siagptBearerToken && !_staticBearerInvalidated) {
    _cachedSiaGptToken = config.siagptBearerToken
    return _cachedSiaGptToken
  }
  const { oauth2TokenUrl, oauth2ClientId, oauth2ClientSecret, zitadelProjectId } = config
  if (!oauth2TokenUrl || !oauth2ClientId || !oauth2ClientSecret || !zitadelProjectId) {
    throw new Error('SiaGPT OAuth2 credentials not configured')
  }
  const authStr = Buffer.from(`${oauth2ClientId}:${oauth2ClientSecret}`).toString('base64')
  const scopeParams = [
    'openid',
    'urn:zitadel:iam:user:resourceowner',
    `urn:zitadel:iam:org:project:id:${zitadelProjectId}:aud`,
    'urn:zitadel:iam:org:projects:roles',
  ].join('+')
  _tokenFetchInFlight = (async () => {
    const response = await fetch(
      `${oauth2TokenUrl}?grant_type=client_credentials&scope=${scopeParams}`,
      { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${authStr}` } },
    )
    if (!response.ok) {
      const body = await response.text()
      throw new Error(`SiaGPT auth failed ${response.status}: ${body}`)
    }
    const tokenData = await response.json() as any
    const access = tokenData.access_token
    const id = tokenData.id_token
    const token = access?.split('.').length === 3 ? access : id ?? access
    if (!token) throw new Error('No usable JWT in SiaGPT OAuth2 response')
    _cachedSiaGptToken = token
    return token
  })()
  try { return await _tokenFetchInFlight } finally { _tokenFetchInFlight = undefined }
}

export function invalidateSiaGptToken() {
  _cachedSiaGptToken = undefined
  _staticBearerInvalidated = true
}

export async function deleteSiaGPTCollection(collectionId: string): Promise<void> {
  if (!collectionId || !config.siagptBaseUrl) return
  const doDelete = async () => {
    const token = await getSiaGptToken()
    return fetch(`${config.siagptBaseUrl}/medias/collections/${collectionId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}`, 'app-origin': 'AI Platform' },
    })
  }
  try {
    let resp = await doDelete()
    if (resp.status === 401 || resp.status === 403) {
      invalidateSiaGptToken()
      resp = await doDelete()
    }
    if (!resp.ok) {
      const body = await resp.text()
      log.warn(`SiaGPT collection deletion failed for ${collectionId}: ${resp.status} ${body}`)
    }
  } catch (e: any) { log.error('SiaGPT collection deletion error', e) }
}

export async function createSiaGPTCollection(name: string, description: string): Promise<string | null> {
  if (!config.siagptMediaFolderId) return null
  const doCreate = async () => {
    const token = await getSiaGptToken()
    return fetch(`${config.siagptBaseUrl}/medias/collections`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'app-origin': 'AI Platform' },
      body: JSON.stringify({ name, description, folderId: config.siagptMediaFolderId }),
    })
  }
  try {
    log.collectionRequest(name, description, config.siagptMediaFolderId)
    let resp = await doCreate()
    if (resp.status === 401 || resp.status === 403) {
      invalidateSiaGptToken()
      resp = await doCreate()
    }
    if (!resp.ok) {
      const body = await resp.text()
      log.warn(`SiaGPT collection creation failed: ${resp.status} ${body}`)
      log.collectionResponse(null, name)
      return null
    }
    const data = await resp.json() as any
    log.collectionResponse(data.uuid || null, name)
    return data.uuid || null
  } catch (e: any) {
    log.error('SiaGPT collection creation error', e)
    log.collectionResponse(null, name)
    return null
  }
}

export async function uploadDocToSiaGPTCollection(
  fileBuffer: Buffer, fileName: string, mimetype: string, collectionId: string
): Promise<string | null> {
  const doUpload = async () => {
    const token = await getSiaGptToken()
    const blob = new Blob([fileBuffer], { type: mimetype })
    const formData = new FormData()
    formData.append('file', blob, fileName)
    formData.append('media_metadata', JSON.stringify({ collectionId }))
    return fetch(`${config.siagptBaseUrl}/medias/`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'app-origin': 'AI Platform', Accept: 'application/json' },
      body: formData,
    })
  }
  try {
    log.docUploadRequest(fileName, mimetype, collectionId)
    let resp = await doUpload()
    if (resp.status === 401) {
      invalidateSiaGptToken()
      resp = await doUpload()
    } else if (resp.status === 403) {
      log.warn(`SiaGPT upload 403 for ${fileName} — collection may be owned by a different user`)
      log.docUploadResponse(fileName, false, 403)
      return null
    }
    if (!resp.ok) {
      const body = await resp.text()
      log.warn(`SiaGPT media upload failed ${resp.status}: ${body}`)
      log.docUploadResponse(fileName, false, resp.status)
      return null
    }
    const data = await resp.json() as any
    log.docUploadResponse(fileName, true)
    return data.uuid || null
  } catch (e: any) {
    log.error('SiaGPT doc upload error', e)
    return null
  }
}

export async function callSiaGPT(
  prompt: string,
  options?: {
    assistantId?: string
    collectionIds?: string[]
    tools?: string[]
    context?: string
    timeoutMs?: number
  }
): Promise<SiaGPTResult> {
  let token: string
  try { token = await getSiaGptToken() } catch (e) { throw e }
  const baseUrl = config.siagptBaseUrl
  const ctx = options?.context ?? 'LLM call'

  // 1. Create discussion
  const discName = `SIA Assessment ${Date.now()}`
  const ownerId = config.siagptOwnerId
  log.discussionRequest(discName, ownerId)
  const discResp = await fetch(`${baseUrl}/chat/discussions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'app-origin': 'AI Platform' },
    body: JSON.stringify({ name: discName, ownerId, ownerType: 'USER' }),
  })
  if (!discResp.ok) {
    if (discResp.status === 401) invalidateSiaGptToken()
    throw new Error(`SiaGPT discussion creation failed: ${discResp.status}`)
  }
  const { uuid: discussionId } = await discResp.json() as any
  log.discussionResponse(discussionId)

  // 2. Post message
  const { v7: uuidv7 } = await import('uuid')
  const msgMeta: Record<string, any> = {
    ...(options?.assistantId ? { assistantId: options.assistantId } : {}),
    attachmentInfos: [],
    tools: options?.tools ?? ['rag', 'document_content', 'list_documents', 'query_table', 'list_table_schemas'],
    ...(options?.collectionIds?.length ? { collectionIds: options.collectionIds } : {}),
  }
  const messageId = uuidv7()
  const msgPayload = {
    question: prompt, messageId, discussionId, ownerId, ownerType: 'USER', messageMetadata: msgMeta,
  }
  log.messageRequest({ ...msgPayload, context: ctx })
  const msgTimeoutMs = options?.timeoutMs ?? 10 * 60 * 1000
  const msgAbort = new AbortController()
  const msgAbortTimer = setTimeout(() => msgAbort.abort(), msgTimeoutMs)
  let msgResp: globalThis.Response
  try {
    msgResp = await fetch(`${baseUrl}/chat/messages/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'app-origin': 'AI Platform' },
      body: JSON.stringify(msgPayload),
      signal: msgAbort.signal,
    })
  } finally { clearTimeout(msgAbortTimer) }
  if (!msgResp.ok) {
    if (msgResp.status === 401) invalidateSiaGptToken()
    const errBody = await msgResp.text()
    log.messageError(`${msgResp.status}: ${errBody}`, ctx)
    throw new Error(`SiaGPT message failed: ${msgResp.status}`)
  }

  const raw = await msgResp.text()
  log.rawResponse(raw, ctx)
  let chosenEvent = 'raw'
  let result: string
  let newSources: Record<string, any> = {}
  let fileUrl: string | undefined
  let fileName: string | undefined

  function extractNewSources(events: any[]) {
    for (const e of events) {
      if (e?.event === 'NEW_SOURCES' && e.sources) Object.assign(newSources, e.sources)
    }
  }

  function extractFileInfo(events: any[], text: string): { url?: string; name?: string } {
    const parts: string[] = []
    for (const e of events as any[]) {
      if (typeof e.data === 'string' && e.data) parts.push(e.data)
      if (e.data && typeof e.data === 'object' && typeof e.data.value === 'string') parts.push(e.data.value)
      if (typeof e.url === 'string' && e.url) parts.push(e.url)
      if (typeof e.path === 'string' && e.path) parts.push(e.path)
      if (typeof e.downloadUrl === 'string' && e.downloadUrl) parts.push(e.downloadUrl)
    }
    if (text) parts.push(text)
    const cumulative = parts.join('\n')
    const mdMatches = [...cumulative.matchAll(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g)]
    if (mdMatches.length > 0) {
      const last = mdMatches[mdMatches.length - 1]
      const name = last[1].replace(/^Download\s+/i, '').trim()
      return { name: name || last[1], url: last[2] }
    }
    const urlMatches = [...cumulative.matchAll(/https?:\/\/[^\s\n<>"')\]]+/g)]
    if (urlMatches.length > 0) {
      const lastUrl = urlMatches[urlMatches.length - 1][0].replace(/[.,)>\]]+$/, '')
      return { url: lastUrl }
    }
    return {}
  }

  try {
    const parsed = JSON.parse(raw)
    const events: any[] = Array.isArray(parsed) ? parsed : [parsed]
    extractNewSources(events)
    const errorEvent = events.find(e => e.event === 'NEW_ERROR')
    if (errorEvent) throw new Error(`SiaGPT error: ${errorEvent.error ?? JSON.stringify(errorEvent)}`)
    const chosen = events.find(e => e.event === 'OVERWRITE_TEXT') ??
      events.find(e => e.event === 'CHAT') ?? events[events.length - 1]
    chosenEvent = chosen?.event ?? 'json'
    result = String(chosen?.data ?? chosen?.content ?? raw)
    const info1 = extractFileInfo(events, result)
    fileUrl = info1.url; fileName = info1.name
  } catch (e: any) {
    if (e.message?.startsWith('SiaGPT error:')) throw e
    const events = raw.split('\n').filter(l => l.trim()).map(l => {
      const p = l.startsWith('data: ') ? l.slice(6) : l
      try { return JSON.parse(p) } catch { return null }
    }).filter(Boolean)
    if (events.length > 0) {
      extractNewSources(events)
      const errorEvent = (events as any[]).find(e => e.event === 'NEW_ERROR')
      if (errorEvent) throw new Error(`SiaGPT error: ${errorEvent.error ?? JSON.stringify(errorEvent)}`)
      const chosen = (events as any[]).find(e => e.event === 'OVERWRITE_TEXT') ??
        (events as any[]).find(e => e.event === 'CHAT') ?? events[events.length - 1]
      chosenEvent = (chosen as any)?.event ?? 'ndjson'
      result = String((chosen as any)?.data ?? (chosen as any)?.content ?? raw)
      const info2 = extractFileInfo(events, result)
      fileUrl = info2.url; fileName = info2.name
    } else {
      result = raw
    }
  }
  log.messageResponse(result, chosenEvent, ctx)
  return { text: result, newSources, fileUrl, fileName }
}
