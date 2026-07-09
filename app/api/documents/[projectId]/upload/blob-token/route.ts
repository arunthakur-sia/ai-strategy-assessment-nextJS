// POST /api/documents/:projectId/upload/blob-token
// Issues short-lived client tokens for direct browser -> Vercel Blob uploads,
// bypassing the platform's 4.5MB serverless function request body limit.
import { NextRequest, NextResponse } from 'next/server'
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client'
import { requireProjectAuth } from '@/lib/server/auth'

export const runtime = 'nodejs'

const ALLOWED_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/msword',
  'application/vnd.ms-excel',
  'image/png',
  'image/jpeg',
  'image/jpg',
]

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params
  const body = (await request.json()) as HandleUploadBody
  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async () => {
        if (!(await requireProjectAuth(request, projectId))) throw new Error('Not authenticated')
        return {
          allowedContentTypes: ALLOWED_TYPES,
          maximumSizeInBytes: 50 * 1024 * 1024,
          addRandomSuffix: true,
        }
      },
    })
    return NextResponse.json(jsonResponse)
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 })
  }
}
