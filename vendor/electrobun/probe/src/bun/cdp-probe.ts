/**
 * The CDP mode of the probe. It opens a system-webview shell window and a CEF browser-preview view in the
 * same window, then drives the preview over the Chrome DevTools Protocol the way OpenWaggle's
 * preview automation does: discover the target, navigate, screenshot, click and type. On Windows
 * the build has no CEF and the preview opens in WebView2's Chromium environment (vendor/electrobun
 * patch 0013). There the system webview and the preview must keep the same-origin policy (patches
 * 0012 and 0013): a page reads another loopback origin only when that origin allows it with CORS.
 * Other platforms record the check without requiring it: Linux CEF turns the policy off by default.
 * Results go to
 * `$PROBE_OUT_DIR/probe.jsonl` and `$PROBE_OUT_DIR/result.json`, and the app quits with a non-zero
 * code when a check fails, so CI can launch it, wait and assert.
 *
 * Environment (all optional):
 * - PROBE_OUT_DIR: where results and the CDP screenshot go; without it the probe stays open.
 * - PROBE_HOLD_MS: keep the window open this long after the checks (for an OS screenshot).
 * - PROBE_PREVIEW_PARTITION: preview partition, default `persist:browser-preview`; `none` for none.
 * - PROBE_PREVIEW_SANDBOX: `0` to create the preview without the sandbox flag.
 * - PROBE_PREVIEW_DELAY_MS: wait this long after the shell renders before opening the preview, so
 *   the harness can sample the idle shell's memory first (default 500).
 * - ELECTROBUN_CEF_REMOTE_DEBUGGING_PORT: DevTools port, set by the launcher on every launch.
 * - PROBE_CDP_PORT: DevTools port when the build fixes one, default 9339.
 */
import { BrowserView, BrowserWindow, BuildConfig, Utils } from 'electrobun/main'
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

type Json = null | boolean | number | string | Json[] | { [key: string]: Json }
type CdpTarget = {
  id: string
  type: string
  url: string
  title: string
  webSocketDebuggerUrl?: string
}
type CdpMessage = {
  id?: number
  method?: string
  result?: Record<string, Json>
  error?: { message: string }
}

const startedAt = Date.now()
const outDir = process.env.PROBE_OUT_DIR
const holdMs = Number(process.env.PROBE_HOLD_MS ?? '0')
const cdpPort = Number(
  process.env.ELECTROBUN_CEF_REMOTE_DEBUGGING_PORT ?? process.env.PROBE_CDP_PORT ?? '9339',
)
const partitionSetting = process.env.PROBE_PREVIEW_PARTITION ?? 'persist:browser-preview'
const partition = partitionSetting === 'none' ? null : partitionSetting
const sandbox = process.env.PROBE_PREVIEW_SANDBOX !== '0'
const previewDelayMs = Number(process.env.PROBE_PREVIEW_DELAY_MS ?? '500')
const TARGET_DISCOVERY_MS = 30_000
const STEP_TIMEOUT_MS = 15_000
const POLL_MS = 250
const TYPED_TEXT = 'ow'

if (outDir) mkdirSync(outDir, { recursive: true })
const checks: Record<string, Json> = {}

function record(event: string, data: Record<string, Json> = {}) {
  const line = JSON.stringify({ event, atMs: Date.now() - startedAt, ...data })
  console.log(`[probe] ${line}`)
  if (outDir) appendFileSync(path.join(outDir, 'probe.jsonl'), `${line}\n`)
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const fixture = Bun.serve({
  hostname: '127.0.0.1',
  port: 0,
  async fetch(request) {
    const pathname = new URL(request.url).pathname
    if (pathname === '/same-origin') {
      return new Response(SAME_ORIGIN_PAGE, {
        headers: { 'content-type': 'text/html; charset=utf-8' },
      })
    }
    if (pathname === '/same-origin-result') {
      const result: Json = JSON.parse(await request.text())
      shellSameOrigin?.(result)
      return new Response('ok')
    }
    const page = pathname === '/b' ? 'b' : 'a'
    const colour = page === 'a' ? '#2f6fde' : '#1f9d63'
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>probe-${page}</title></head>
<body style="margin:0;font:16px system-ui,sans-serif;background:${colour};color:white">
<h1 style="margin:24px">Preview page ${page.toUpperCase()}</h1>
<p style="margin:24px">Rendered by CEF, driven over CDP.</p>
<input id="field" style="margin:24px;font-size:20px;width:300px" placeholder="typed over CDP">
<button id="button" style="margin:24px;font-size:20px" onclick="document.title='clicked-'+document.title">Click</button>
</body></html>`
    return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } })
  },
})
const fixtureOrigin = `http://127.0.0.1:${fixture.port}`

/** Another origin: `/plain` sends no CORS headers, `/cors` allows the fixture's origin. */
const other = Bun.serve({
  hostname: '127.0.0.1',
  port: 0,
  fetch(request) {
    const cors = new URL(request.url).pathname === '/cors'
    return new Response('secret', {
      headers: cors ? { 'access-control-allow-origin': fixtureOrigin } : {},
    })
  },
})
const otherOrigin = `http://127.0.0.1:${other.port}`

/** Reads `/plain` and `/cors` of the other origin; each is `read` or `blocked`. */
const SAME_ORIGIN_SCRIPT = `Promise.all(['plain', 'cors'].map((name) =>
  fetch(${JSON.stringify(otherOrigin)} + '/' + name).then((response) => response.text())
    .then((text) => (text === 'secret' ? 'read' : 'empty'), () => 'blocked')))
  .then(([plain, cors]) => ({ plain, cors }))`

/** A page of the fixture's origin that runs the check and posts the result back to it. */
const SAME_ORIGIN_PAGE = `<!doctype html><title>same-origin</title><script>
${SAME_ORIGIN_SCRIPT}.then((result) => fetch('/same-origin-result', { method: 'POST', body: JSON.stringify(result) }))
</script>`

let shellSameOrigin: ((result: Json) => void) | null = null

async function listTargets() {
  const response = await fetch(`http://127.0.0.1:${cdpPort}/json/list`)
  if (!response.ok) throw new Error(`DevTools target list failed: HTTP ${response.status}`)
  const targets: CdpTarget[] = await response.json()
  return targets
}

/** Polls the DevTools endpoint and records every change in the target list until the preview shows. */
async function discoverPreviewTarget() {
  const deadline = Date.now() + TARGET_DISCOVERY_MS
  let last = ''
  while (Date.now() < deadline) {
    const targets = await listTargets().catch((error: unknown) => {
      const message = String(error)
      if (message !== last) record('cdp-endpoint-unavailable', { error: message })
      last = message
      return null
    })
    if (targets !== null) {
      const summary = JSON.stringify(targets.map((target) => `${target.type} ${target.url}`))
      if (summary !== last) record('cdp-targets', { targets: JSON.parse(summary) })
      last = summary
      const preview = targets.find((target) => target.url.startsWith(fixtureOrigin))
      if (preview?.webSocketDebuggerUrl) return preview
    }
    await delay(POLL_MS)
  }
  return null
}

class CdpSession {
  private nextId = 1
  private readonly pending = new Map<number, (message: CdpMessage) => void>()
  private readonly listeners = new Set<(message: CdpMessage) => void>()

  private constructor(private readonly socket: WebSocket) {
    socket.addEventListener('message', (event) => {
      const message: CdpMessage = JSON.parse(String(event.data))
      if (message.id !== undefined) this.pending.get(message.id)?.(message)
      for (const listener of this.listeners) listener(message)
    })
  }

  static async connect(url: string) {
    const socket = new WebSocket(url)
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve)
      socket.addEventListener('error', () => reject(new Error(`CDP socket failed: ${url}`)))
    })
    return new CdpSession(socket)
  }

  send(method: string, params: Record<string, Json> = {}) {
    const id = this.nextId++
    return new Promise<Record<string, Json>>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${method} timed out`)), STEP_TIMEOUT_MS)
      this.pending.set(id, (message) => {
        clearTimeout(timer)
        this.pending.delete(id)
        if (message.error) reject(new Error(`${method}: ${message.error.message}`))
        else resolve(message.result ?? {})
      })
      this.socket.send(JSON.stringify({ id, method, params }))
    })
  }

  waitFor(method: string) {
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${method} not received`)), STEP_TIMEOUT_MS)
      const listener = (message: CdpMessage) => {
        if (message.method !== method) return
        clearTimeout(timer)
        this.listeners.delete(listener)
        resolve()
      }
      this.listeners.add(listener)
    })
  }

  async evaluate(expression: string) {
    const result = await this.send('Runtime.evaluate', { expression, returnByValue: true })
    const remote = result.result
    return remote !== null && typeof remote === 'object' && !Array.isArray(remote)
      ? (remote.value ?? null)
      : null
  }

  close() {
    this.socket.close()
  }
}

async function driveOverCdp(target: CdpTarget) {
  if (!target.webSocketDebuggerUrl) throw new Error('Preview target has no WebSocket URL')
  const cdp = await CdpSession.connect(target.webSocketDebuggerUrl)
  try {
    await cdp.send('Page.enable')
    await cdp.send('Runtime.enable')
    const loaded = cdp.waitFor('Page.loadEventFired')
    await cdp.send('Page.navigate', { url: `${fixtureOrigin}/b` })
    await loaded
    // WebView2 can fire the first page's load event after Page.enable; wait for page B's title.
    const titleDeadline = Date.now() + STEP_TIMEOUT_MS
    do {
      checks.navigatedTitle = await cdp.evaluate('document.title')
      if (checks.navigatedTitle === 'probe-b') break
      await delay(POLL_MS)
    } while (Date.now() < titleDeadline)

    const shot = await cdp.send('Page.captureScreenshot', { format: 'png' })
    const data = typeof shot.data === 'string' ? shot.data : ''
    checks.screenshotBytes = Buffer.from(data, 'base64').length
    if (outDir && data)
      writeFileSync(path.join(outDir, 'preview-cdp.png'), Buffer.from(data, 'base64'))

    const centre = async (selector: string) => {
      const value = await cdp.evaluate(
        `(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2] })()`,
      )
      if (!Array.isArray(value)) throw new Error(`No element ${selector}`)
      const [x, y] = value
      if (typeof x !== 'number' || typeof y !== 'number')
        throw new Error(`Bad rect for ${selector}`)
      return { x, y }
    }
    const click = async (selector: string) => {
      const { x, y } = await centre(selector)
      const base = { x, y, button: 'left', clickCount: 1 }
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...base })
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...base })
    }
    await click('#field')
    for (const key of TYPED_TEXT) {
      await cdp.send('Input.dispatchKeyEvent', {
        type: 'keyDown',
        key,
        text: key,
        unmodifiedText: key,
      })
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key })
    }
    checks.typedValue = await cdp.evaluate(`document.getElementById('field').value`)
    await click('#button')
    checks.clickedTitle = await cdp.evaluate('document.title')
    const sameOrigin = await cdp.send('Runtime.evaluate', {
      expression: SAME_ORIGIN_SCRIPT,
      awaitPromise: true,
      returnByValue: true,
    })
    const remote = sameOrigin.result
    checks.previewSameOrigin =
      remote !== null && typeof remote === 'object' && !Array.isArray(remote)
        ? (remote.value ?? null)
        : null
  } finally {
    cdp.close()
  }
  return (
    checks.navigatedTitle === 'probe-b' &&
    typeof checks.screenshotBytes === 'number' &&
    checks.screenshotBytes > 0 &&
    checks.typedValue === TYPED_TEXT &&
    checks.clickedTitle === 'clicked-probe-b' &&
    keepsSameOriginPolicy(checks.previewSameOrigin)
  )
}

/** Required on Windows, whose patches keep the policy on; recorded elsewhere. */
const SAME_ORIGIN_REQUIRED = process.platform === 'win32'

function keepsSameOriginPolicy(result: Json | undefined) {
  if (!SAME_ORIGIN_REQUIRED) return true
  return (
    result !== null &&
    typeof result === 'object' &&
    !Array.isArray(result) &&
    result.plain === 'blocked' &&
    result.cors === 'read'
  )
}

/** Runs the check in a hidden system-webview view of the shell window, the app's own webviews. */
async function checkShellSameOrigin() {
  // A Linux process cannot mix CEF and WebKitGTK views.
  if (process.platform === 'linux') return true
  const result = new Promise<Json>((resolve) => {
    shellSameOrigin = resolve
  })
  const view = new BrowserView({
    windowId: win.id,
    url: `${fixtureOrigin}/same-origin`,
    frame: { x: 0, y: 0, width: 1, height: 1 },
    renderer: 'native',
    autoResize: false,
  })
  const timeout = delay(STEP_TIMEOUT_MS).then(() => 'timed out')
  checks.shellSameOrigin = await Promise.race([result, timeout])
  view.remove()
  record('shell-same-origin', { result: checks.shellSameOrigin })
  return keepsSameOriginPolicy(checks.shellSameOrigin)
}

async function finish(ok: boolean, extra: Record<string, Json> = {}) {
  const result = {
    ok,
    platform: process.platform,
    arch: process.arch,
    elapsedMs: Date.now() - startedAt,
    checks,
    ...extra,
  }
  record('result', result)
  if (outDir)
    writeFileSync(path.join(outDir, 'result.json'), `${JSON.stringify(result, null, 2)}\n`)
  if (!outDir) return
  if (holdMs > 0) await delay(holdMs)
  fixture.stop(true)
  other.stop(true)
  Utils.quit(ok ? 0 : 1)
}

const build = await BuildConfig.get()
// Without CEF, Windows serves `renderer: 'cef'` views from WebView2 (patch 0013).
const cefAvailable = build.availableRenderers.includes('cef') || process.platform === 'win32'
record('start', {
  defaultRenderer: build.defaultRenderer,
  availableRenderers: build.availableRenderers,
  partition,
  sandbox,
  cdpPort,
})

const win = new BrowserWindow({
  title: 'OpenWaggle native layer probe',
  url: 'views://mainview/index.html',
  frame: { x: 60, y: 60, width: 1000, height: 680 },
})

let previewStarted = false
win.webview.on('dom-ready', () => {
  record('shell-dom-ready')
  if (previewStarted) return
  previewStarted = true
  void checkShellSameOrigin().then((shellOk) => {
    if (!cefAvailable) {
      void delay(previewDelayMs).then(() =>
        finish(shellOk, { cdp: 'skipped: this build has no CEF renderer' }),
      )
      return
    }
    setTimeout(() => openPreview(shellOk), previewDelayMs)
  })
})

function openPreview(shellOk: boolean) {
  const view = new BrowserView({
    windowId: win.id,
    url: `${fixtureOrigin}/a`,
    frame: { x: 470, y: 80, width: 510, height: 580 },
    renderer: 'cef',
    partition,
    sandbox,
    autoResize: false,
  })
  record('preview-created', { viewId: view.id })
  view.on('dom-ready', () => record('preview-dom-ready'))
  void (async () => {
    const target = await discoverPreviewTarget()
    if (target === null) {
      await finish(false, { error: 'The preview never appeared in /json/list' })
      return
    }
    record('cdp-preview-target', { url: target.url, type: target.type })
    const ok = await driveOverCdp(target).catch(async (error: unknown) => {
      checks.error = String(error)
      return false
    })
    await finish(ok && shellOk)
  })()
}
