import 'server-only'

const encoder = new TextEncoder()

export function createSSEStream(
  handler: (send: (data: object) => void, close: () => void) => Promise<void>
): Response {
  let _controller: ReadableStreamDefaultController<Uint8Array> | null = null
  let _closed = false

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      _controller = controller

      const send = (data: object) => {
        if (_closed) return
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
        } catch { /* client disconnected */ }
      }

      const close = () => {
        if (_closed) return
        _closed = true
        try { controller.close() } catch { /* already closed */ }
      }

      // Run the async handler. Errors are caught and sent as SSE error events.
      handler(send, close).catch(err => {
        send({ error: err?.message ?? 'Unknown error' })
        close()
      })
    },
    cancel() {
      _closed = true
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
