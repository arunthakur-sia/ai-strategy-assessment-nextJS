import { NextRequest, NextResponse } from 'next/server'
import { v4 as uuidv4 } from 'uuid'
import { del, get } from '@vercel/blob'
import { loadProject, saveProject, extractText } from '@/lib/server/helpers'
import { getSiaGptToken, uploadDocToSiaGPTCollection } from '@/lib/server/siagpt'
import { requireProjectAuth } from '@/lib/server/auth'

export const runtime = 'nodejs'
export const maxDuration = 120

const allowedTypes = ['application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.openxmlformats-officedocument.presentationml.presentation','application/msword','application/vnd.ms-excel','image/png','image/jpeg','image/jpg']

interface UploadedBlob { url: string; name: string; type: string; size: number }

export async function POST(request: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  if (!await requireProjectAuth(request, projectId)) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  try {
    const project = await loadProject(projectId)
    if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

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

    if (project.siagptCollectionId) await getSiaGptToken().catch(() => {})
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
      project.documents.push(doc)
      if (project.siagptCollectionId) {
        const mediaId = await uploadDocToSiaGPTCollection(buffer, file.name, file.type, project.siagptCollectionId)
        if (mediaId) doc.siagptMediaId = mediaId
      }
      results.push({ id: doc.id, name: doc.name, type: doc.type, wordCount: doc.wordCount, preview: extractedText.substring(0, 300), siagptMediaId: doc.siagptMediaId })
      await del(file.url).catch(() => {})
    }
    await saveProject(project)
    return NextResponse.json({ success: true, documents: results })
  } catch (err: any) { return NextResponse.json({ error: err.message }, { status: 500 }) }
}
