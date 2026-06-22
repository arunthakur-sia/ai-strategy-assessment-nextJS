import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/server/db'
import { generateProjectToken, getSession, setSessionCookie } from '@/lib/server/auth'
import { migrate } from '@/lib/server/migrate'

export const runtime = 'nodejs'

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await migrate()
  const { id } = await params
  try {
    const bcrypt = await import('bcryptjs')
    const { password } = await request.json()
    if (!password) return NextResponse.json({ error: 'password required' }, { status: 400 })

    const { data, error } = await supabase.from('projects').select('data').eq('id', id).single()
    if (error || !data) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

    const project = data.data
    const valid = await bcrypt.default.compare(password, project.passwordHash)
    if (!valid) return NextResponse.json({ error: 'Invalid password' }, { status: 401 })

    const token = generateProjectToken(id)
    const { passwordHash, ...safeProject } = project
    const response = NextResponse.json({ success: true, project: safeProject, token })

    const session = await getSession()
    if (!session.unlockedProjects.includes(id)) session.unlockedProjects.push(id)
    setSessionCookie(response, session)
    return response
  } catch (err: any) { return NextResponse.json({ error: err.message }, { status: 500 }) }
}
