// POST /api/documents/:projectId/:entityId/upload — upload docs for a subsidiary entity
import { NextRequest, NextResponse } from 'next/server'
import { v4 as uuidv4 } from 'uuid'
import { del, get } from '@vercel/blob'
import { loadProject, saveProject, extractText } from '@/lib/server/helpers'
import { getSiaGptToken, uploadDocToSiaGPTCollection, createSiaGPTCollection } from '@/lib/server/siagpt'
import { requireProjectAuth } from '@/lib/server/auth'
import { config } from '@/lib/server/config'
import { log } from '@/lib/server/logger'

export const runtime = 'nodejs'
export const maxDuration = 120

const allowedTypes = ['application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.openxmlformats-officedocument.presentationml.presentation','application/msword','application/vnd.ms-excel','image/png','image/jpeg','image/jpg']

interface UploadedBlob { url: string; name: string; type: string; size: number }

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; segment: string }> }
) {
  const { projectId, segment: entityId } = await params
  if (!await requireProjectAuth(request, projectId)) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  try {
    const project = await loadProject(projectId)
    if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    const entity = (project.entities || []).find((e: any) => e.id === entityId)
    if (!entity) return NextResponse.json({ error: 'Entity not found' }, { status: 404 })

    const { files, docType, docLabel } = await request.json() as {
      files: UploadedBlob[]
      docType?: string
      docLabel?: string
    }
    if (!files?.length) return NextResponse.json({ error: 'No files uploaded' }, { status: 400 })

    for (const file of files) {
      if (!allowedTypes.includes(file.type)) {
        return NextResponse.json({ error: `File type ${file.type} not supported` }, { status: 400 })
      }
    }

    // Verify entity collection access — recreate if inaccessible
    if (entity.siagptCollectionId && config.siagptBaseUrl) {
      const preToken = await getSiaGptToken().catch(() => null)
      if (preToken) {
        const verifyResp = await fetch(
          `${config.siagptBaseUrl}/medias/collections/${entity.siagptCollectionId}`,
          { headers: { Authorization: `Bearer ${preToken}`, 'app-origin': 'AI Platform' } }
        ).catch(() => null)
        if (verifyResp && (verifyResp.status === 403 || verifyResp.status === 404)) {
          log.warn(`Entity collection ${entity.siagptCollectionId} inaccessible — recreating for "${entity.name}"`)
          const newCollId = await createSiaGPTCollection(entity.name, `SIA Partners strategy assessment collection for ${entity.name}`)
          entity.siagptCollectionId = newCollId ?? ''
        }
      }
    } else if (entity.siagptCollectionId) {
      await getSiaGptToken().catch(() => {})
    }

    const results = []
    for (const file of files) {
      const blobResult = await get(file.url, { access: 'private' })
      if (!blobResult) throw new Error(`Blob not found: ${file.name}`)
      const buffer = Buffer.from(await new Response(blobResult.stream).arrayBuffer())
      const extractedText = await extractText(buffer, file.type, file.name)
      const doc: any = {
        id: uuidv4(), name: file.name, type: docType || 'general', label: docLabel || file.name,
        mimetype: file.type, size: file.size, extractedText,
        uploadedAt: new Date().toISOString(),
        wordCount: extractedText.split(/\s+/).filter(Boolean).length,
        siagptMediaId: '',
      }
      entity.documents.push(doc)
      if (entity.siagptCollectionId) {
        const mediaId = await uploadDocToSiaGPTCollection(buffer, file.name, file.type, entity.siagptCollectionId)
        if (mediaId) doc.siagptMediaId = mediaId
      }
      results.push({ id: doc.id, name: doc.name, type: doc.type, wordCount: doc.wordCount, preview: extractedText.substring(0, 300), siagptMediaId: doc.siagptMediaId })
      await del(file.url).catch(() => {})
    }
    await saveProject(project)
    return NextResponse.json({ success: true, documents: results })
  } catch (err: any) { return NextResponse.json({ error: err.message }, { status: 500 }) }
}
