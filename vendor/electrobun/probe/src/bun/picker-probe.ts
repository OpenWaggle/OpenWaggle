/**
 * The element picker part of the adapter probe: it starts the preview's annotation picker on a
 * real CEF page and drives it as a person would, through CEF's DevTools endpoint (mouse, typing,
 * Enter and Escape), then checks the annotation the BrowserPreviewViews port returns.
 */
import type { BrowserPreviewViewsShape } from '../../../../../src/main/ports/desktop-shell/browser-preview-views'
import type { RendererSurface } from '../../../../../src/main/ports/desktop-shell/renderer-surfaces'

type Json = null | boolean | number | string | Json[] | { [key: string]: Json }

const STEP_MS = 30_000
const OVERLAY = '[data-openwaggle-browser-annotation-ui]'
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** The pick fixture: a page with one button to annotate. */
export const PICK_PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>probe-pick</title></head>
<body style="margin:0;font:16px system-ui,sans-serif;background:#fff;color:#111">
<h1 style="margin:24px">Annotate the button</h1>
<button id="target" style="margin:24px;padding:12px 24px;font-size:18px">Save changes</button>
</body></html>`

interface Cdp {
  send(method: string, params?: Record<string, unknown>): Promise<Record<string, unknown>>
  close(): void
}

async function connect(port: string, url: string): Promise<Cdp> {
  const deadline = Date.now() + STEP_MS
  while (Date.now() < deadline) {
    const targets = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()) as {
      type: string
      url: string
      webSocketDebuggerUrl?: string
    }[]
    const target = targets.find((candidate) => candidate.type === 'page' && candidate.url === url)
    if (target?.webSocketDebuggerUrl) {
      const socket = new WebSocket(target.webSocketDebuggerUrl)
      await new Promise((resolve, reject) => {
        socket.onopen = resolve
        socket.onerror = reject
      })
      let id = 1
      const pending = new Map<number, (value: Record<string, unknown>) => void>()
      socket.onmessage = (event) => {
        const message = JSON.parse(String(event.data))
        if (typeof message.id === 'number') pending.get(message.id)?.(message.result ?? {})
      }
      return {
        send: (method, params = {}) => {
          const next = id++
          socket.send(JSON.stringify({ id: next, method, params }))
          return new Promise((resolve) => pending.set(next, resolve))
        },
        close: () => socket.close(),
      }
    }
    await delay(250)
  }
  throw new Error(`No DevTools target for ${url}`)
}

async function evaluate(cdp: Cdp, expression: string): Promise<unknown> {
  const result = await cdp.send('Runtime.evaluate', { expression, returnByValue: true })
  return (result.result as { value?: unknown } | undefined)?.value
}

async function waitForOverlay(cdp: Cdp, present: boolean) {
  const deadline = Date.now() + STEP_MS
  while (Date.now() < deadline) {
    if ((await evaluate(cdp, `!!document.querySelector('${OVERLAY}')`)) === present) return
    await delay(100)
  }
  throw new Error(`The annotation overlay was ${present ? 'never shown' : 'never removed'}`)
}

function withinStep<T>(label: string, work: Promise<T>): Promise<T> {
  return Promise.race([
    work,
    delay(STEP_MS).then(() => {
      throw new Error(`${label}: timed out`)
    }),
  ])
}

async function key(cdp: Cdp, name: 'Enter' | 'Escape') {
  const code = name === 'Enter' ? 13 : 27
  const text = name === 'Enter' ? { text: '\r' } : {}
  await cdp.send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: name,
    code: name,
    windowsVirtualKeyCode: code,
    ...text,
  })
  await cdp.send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: name,
    code: name,
    windowsVirtualKeyCode: code,
  })
}

/** Cancels one pick with Escape in the page, then annotates the button with a comment. */
export async function probePicker(
  views: BrowserPreviewViewsShape,
  page: RendererSurface,
  previewId: string,
  url: string,
  port: string,
): Promise<Record<string, Json>> {
  const cdp = await connect(port, url)
  try {
    const escaped = views.pickElement(page, previewId)
    await waitForOverlay(cdp, true)
    await key(cdp, 'Escape')
    const escapedResult = await withinStep('Escape pick', escaped)
    await waitForOverlay(cdp, false)

    const picked = views.pickElement(page, previewId)
    await waitForOverlay(cdp, true)
    const centre = (await evaluate(
      cdp,
      `(() => { const r = document.getElementById('target').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })()`,
    )) as { x: number; y: number }
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...centre })
    await delay(100)
    const button = { button: 'left', clickCount: 1 }
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      ...centre,
      ...button,
      buttons: 1,
    })
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      ...centre,
      ...button,
      buttons: 0,
    })
    await delay(300)
    await cdp.send('Input.insertText', { text: 'Make the probe button primary.' })
    await key(cdp, 'Enter')
    const annotation = await withinStep('annotation', picked)
    await waitForOverlay(cdp, false)
    const target = annotation?.elements[0]?.element
    return {
      escapedResult: escapedResult === null ? null : 'annotation',
      elements: annotation?.elements.length ?? 0,
      tagName: target?.tagName ?? null,
      text: target?.text ?? null,
      comment: annotation?.comment ?? null,
      pageTitle: annotation?.pageTitle ?? null,
      screenshot:
        annotation === null
          ? null
          : { width: annotation.screenshot.width, height: annotation.screenshot.height },
      attachment: annotation?.attachment?.origin ?? null,
    }
  } finally {
    cdp.close()
  }
}
