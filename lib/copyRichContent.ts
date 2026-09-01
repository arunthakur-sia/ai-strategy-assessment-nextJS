// Copies a rendered DOM node the same way other chat UIs' "copy" buttons do:
// both a text/html and a text/plain flavor, so pasting into Word/Docs/Slack keeps
// formatting (bold, lists, tables) while plain-text targets still get clean text.
export async function copyRenderedElement(el: HTMLElement): Promise<void> {
  // Strip UI chrome (e.g. the per-table export toolbar) that shouldn't end up in copied content.
  const clone = el.cloneNode(true) as HTMLElement
  clone.querySelectorAll('.md-table-toolbar').forEach(node => node.remove())

  const html = clone.innerHTML
  const text = clone.textContent ?? ''

  if (navigator.clipboard && typeof window !== 'undefined' && 'ClipboardItem' in window) {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([text], { type: 'text/plain' }),
        }),
      ])
      return
    } catch {
      // fall through to plain-text copy below
    }
  }

  await navigator.clipboard.writeText(text)
}
