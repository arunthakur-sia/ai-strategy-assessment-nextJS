import { Router } from 'express'

const router = Router()

router.post('/siagpt', async (req, res) => {
  const { event, payload, userId } = req.body

  if (!event || !payload) {
    return res.status(400).json({ error: 'event and payload are required' })
  }

  try {
    switch (event) {
      case 'project.created':
        console.log(`[SiaGPT Webhook] project.created for user ${userId}:`, payload)
        break

      case 'assessment.requested':
        console.log(`[SiaGPT Webhook] assessment.requested:`, payload)
        break

      case 'report.requested':
        console.log(`[SiaGPT Webhook] report.requested:`, payload)
        break

      default:
        console.log(`[SiaGPT Webhook] Unknown event: ${event}`)
    }

    return res.json({ received: true, event, timestamp: new Date().toISOString() })
  } catch (err: any) {
    console.error('[SiaGPT Webhook] Error:', err)
    return res.status(500).json({ error: 'Webhook processing failed' })
  }
})

export default router
