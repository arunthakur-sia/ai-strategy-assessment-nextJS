import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/server/db'
import { config } from '@/lib/server/config'
import { createDefaultProject, createDefaultEntity, saveProject } from '@/lib/server/helpers'
import { createSiaGPTCollection, getSiaGptToken } from '@/lib/server/siagpt'
import { generateProjectToken } from '@/lib/server/auth'
import { log } from '@/lib/server/logger'
import { migrate } from '@/lib/server/migrate'

export const runtime = 'nodejs'
export const maxDuration = 60

export async function GET() {
  await migrate()
  try {
    const { data: rows, error } = await supabase
      .from('projects')
      .select('id, name, entity_name, entity_type, data')
      .order('updated_at', { ascending: false })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json(
      (rows ?? []).map((r: any) => ({
        id: r.id,
        name: r.name,
        entityName: r.entity_name,
        entityType: r.entity_type,
        updatedAt: r.data?.updatedAt,
        createdAt: r.data?.createdAt,
      }))
    )
  } catch (err: any) { return NextResponse.json({ error: err.message }, { status: 500 }) }
}

export async function POST(request: NextRequest) {
  await migrate()
  try {
    const bcrypt = await import('bcryptjs')
    const body = await request.json()
    const { name, entityName, entityType, password, consultantName, entities: entitiesInput } = body
    if (!name || !entityName || !password) {
      return NextResponse.json({ error: 'name, entityName, and password are required' }, { status: 400 })
    }

    const project = createDefaultProject(name, entityName, entityType)
    project.passwordHash = await bcrypt.default.hash(password, 12)
    project.consultantName = consultantName || ''

    const validEntities: Array<{ name: string; type: string }> = []
    if (Array.isArray(entitiesInput)) {
      for (const ei of entitiesInput) {
        if (ei?.name?.trim()) validEntities.push({ name: ei.name.trim(), type: ei.type || 'corporate' })
      }
    }

    const pendingWarnings: string[] = []
    if (config.siagptMediaFolderId) {
      await getSiaGptToken()
      const holdingCollId = await createSiaGPTCollection(
        entityName,
        `SIA Partners strategy assessment collection for ${entityName}`,
      )
      if (!holdingCollId) {
        return NextResponse.json({
          error: `Failed to create SiaGPT document collection for "${entityName}". Please retry.`,
          retryable: true,
        }, { status: 503 })
      }
      project.siagptCollectionId = holdingCollId

      const entityCollResults = await Promise.all(
        validEntities.map(async e => {
          const collId = await createSiaGPTCollection(e.name, `SIA Partners strategy assessment collection for ${e.name}`)
          return { entity: e, collId }
        })
      )
      for (const { entity, collId } of entityCollResults) {
        if (!collId) {
          log.warn(`Skipping entity "${entity.name}" — SiaGPT collection creation failed`)
          pendingWarnings.push(entity.name)
          continue
        }
        const ent = createDefaultEntity(entity.name, entity.type)
        ent.siagptCollectionId = collId
        project.entities.push(ent)
      }
    } else {
      for (const e of validEntities) {
        project.entities.push(createDefaultEntity(e.name, e.type))
      }
    }

    await saveProject(project)
    log.projectCreate(name, entityName, project.id)

    const token = generateProjectToken(project.id)
    const { passwordHash, ...safeProject } = project

    const response = NextResponse.json({
      success: true, project: safeProject, token,
      ...(pendingWarnings.length ? { pendingWarnings } : {}),
    })
    // Set session cookie
    const { setSessionCookie, getSession } = await import('@/lib/server/auth')
    const session = await getSession()
    if (!session.unlockedProjects.includes(project.id)) session.unlockedProjects.push(project.id)
    setSessionCookie(response, session)
    return response
  } catch (err: any) { return NextResponse.json({ error: err.message }, { status: 500 }) }
}
