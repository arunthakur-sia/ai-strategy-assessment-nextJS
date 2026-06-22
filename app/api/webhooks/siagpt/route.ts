import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  try {
    const { event, payload, userId } = await request.json()
    if (!event || !payload) return NextResponse.json({ error: 'event and payload are required' }, { status: 400 })

    switch (event) {
      case 'project.created':
        console.log(`[SiaGPT Webhook] project.created for user ${userId}:`, payload); break
      case 'assessment.requested':
        console.log(`[SiaGPT Webhook] assessment.requested:`, payload); break
      case 'report.requested':
        console.log(`[SiaGPT Webhook] report.requested:`, payload); break
      default:
        console.log(`[SiaGPT Webhook] Unknown event: ${event}`)
    }

    return NextResponse.json({ received: true, event, timestamp: new Date().toISOString() })
  } catch (err: any) {
    console.error('[SiaGPT Webhook] Error:', err)
    return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 })
  }
}
