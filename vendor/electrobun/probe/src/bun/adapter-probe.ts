/**
 * The adapter mode of the probe (`PROBE_MODE=adapter`): it runs OpenWaggle's Electrobun Browser
 * preview adapter (src/main/adapters/electrobun/electrobun-browser-preview-views.ts) in this app,
 * against the real native layer, and checks what the renderer would see through the
 * BrowserPreviewViews port: CEF views in the shell window, CDP on the per-launch DevTools port
 * (vendor/electrobun patch 0007), navigation and history state, emulation, screenshots, muting,
 * cookies set into a profile, profile isolation and clearing, and, across two launches, that a
 * `persist:*` profile keeps its cookies. picker-probe.ts annotates a page with the element picker.
 *
 * Results go to `$PROBE_OUT_DIR/probe.jsonl` and `result.json` like the CDP mode, so
 * scripts/electrobun-probe.ts runs both.
 */
import { BrowserWindow, Utils } from 'electrobun/main'
import { EventEmitter } from 'node:events'
import { appendFileSync, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { createElectrobunBrowserPreviewViews } from '../../../../../src/main/adapters/electrobun/electrobun-browser-preview-views'
import { loadElectrobun } from '../../../../../src/main/adapters/electrobun/electrobun-sdk'
import { PICK_PAGE, probePicker } from './picker-probe'

type Json = null | boolean | number | string | Json[] | { [key: string]: Json }
interface PreviewState {
  readonly previewId: string
  readonly url: string
  readonly title: string
  readonly loading: boolean
  readonly canGoBack: boolean
  readonly audioMuted: boolean
  readonly error: { readonly code: string; readonly description: string } | null
}

const OWNER_KEY = 'session:probe'
// PROBE_ADAPTER_PROFILE: the persistent profile under test (default `default`).
const PROFILE = process.env.PROBE_ADAPTER_PROFILE ?? 'default'
const CLEARED_PROFILE = 'probe-cleared'
const INCOGNITO = 'incognito'
const COOKIE = 'ow_probe'
const STEP_MS = 30_000
const BOUNDS = { x: 470, y: 80, width: 510, height: 580 }

const startedAt = Date.now()
const outDir = process.env.PROBE_OUT_DIR
const holdMs = Number(process.env.PROBE_HOLD_MS ?? '0')
const checks: Record<string, Json> = {}
// Read before the adapter takes the variable out of the environment.
const launchPort = process.env.ELECTROBUN_CEF_REMOTE_DEBUGGING_PORT ?? null

if (outDir) mkdirSync(outDir, { recursive: true })

function record(event: string, data: Record<string, Json> = {}) {
  const line = JSON.stringify({ event, atMs: Date.now() - startedAt, ...data })
  console.log(`[probe] ${line}`)
  if (outDir) appendFileSync(path.join(outDir, 'probe.jsonl'), `${line}\n`)
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const fixture = Bun.serve({
  hostname: '127.0.0.1',
  port: 0,
  fetch(request) {
    const url = new URL(request.url)
    if (url.pathname === '/cookie') {
      const cookie = /(?:^|;\s*)ow_probe=([^;]*)/.exec(request.headers.get('cookie') ?? '')
      const title = `cookie:${cookie?.[1] ?? 'none'}`
      return new Response(`<!doctype html><title>${title}</title><p>${title}</p>`, {
        headers: { 'content-type': 'text/html; charset=utf-8' },
      })
    }
    if (url.pathname === '/pick') {
      return new Response(PICK_PAGE, { headers: { 'content-type': 'text/html; charset=utf-8' } })
    }
    const page = url.pathname === '/b' ? 'b' : 'a'
    const colour = page === 'a' ? '#2f6fde' : '#1f9d63'
    return new Response(
      `<!doctype html><html><head><meta charset="utf-8"><title>probe-${page}</title></head>
<body style="margin:0;font:16px system-ui,sans-serif;background:${colour};color:white">
<h1 style="margin:24px">Adapter preview page ${page.toUpperCase()}</h1>
<p style="margin:24px">A CEF view of OpenWaggle's Electrobun Browser preview adapter.</p>
</body></html>`,
      { headers: { 'content-type': 'text/html; charset=utf-8' } },
    )
  },
})
const origin = `http://127.0.0.1:${fixture.port}`

await loadElectrobun()

// PROBE_HIDDEN=1 keeps the window off screen, for runs on a developer's machine.
const hidden = process.env.PROBE_HIDDEN === '1'
const win = new BrowserWindow({
  title: 'OpenWaggle Browser preview adapter probe',
  url: 'views://mainview/index.html',
  frame: { x: 60, y: 60, width: 1000, height: 680 },
  hidden,
  activate: !hidden,
})

/** The shell page as the RendererSurface the adapter's owner is. */
const states = new Map<string, PreviewState>()
const stateListeners = new Set<() => void>()
const page = Object.assign(new EventEmitter(), {
  id: win.webview.id,
  isDestroyed: () => false,
  getURL: () => 'views://mainview/index.html',
  send: (channel: string, payload: PreviewState) => {
    if (channel !== 'browser-preview:state') return
    states.set(payload.previewId, payload)
    for (const listener of stateListeners) listener()
  },
  focus: () => undefined,
})

async function until(label: string, previewId: string, test: (state: PreviewState) => boolean) {
  const deadline = Date.now() + STEP_MS
  while (Date.now() < deadline) {
    const state = states.get(previewId)
    if (state !== undefined && test(state)) return state
    await new Promise<void>((resolve) => {
      const done = () => {
        stateListeners.delete(done)
        resolve()
      }
      stateListeners.add(done)
      setTimeout(done, 250)
    })
  }
  throw new Error(
    `${label}: timed out, last state ${JSON.stringify(states.get(previewId) ?? null)}`,
  )
}

const loaded = (url: string) => (state: PreviewState) =>
  state.url === url && !state.loading && state.title !== '' && !state.title.startsWith('about:')

const views = createElectrobunBrowserPreviewViews({
  appPaths: { userData: () => path.join(outDir ?? Utils.paths.userData, 'user-data') },
  clipboard: { writeImage: async () => 'written' },
  osShell: { showItemInFolder: () => undefined },
  // The probe has no Session Host; the attachment echoes what the picker prepared.
  prepareAnnotation: async (entry) => ({
    id: 'probe-annotation',
    kind: 'image',
    origin: entry.origin,
    name: path.basename(entry.path),
    path: entry.path,
    mimeType: 'image/png',
    sizeBytes: statSync(entry.path).size,
    extractedText: entry.browserAnnotationText,
    browserPreview: entry.browserPreview,
  }),
})

function open(previewId: string, profileId: string, url: string) {
  return views.open(page, {
    previewId,
    ownerKey: OWNER_KEY,
    profileId,
    url,
    bounds: BOUNDS,
    visible: true,
  })
}

async function cookieTitle(previewId: string, profileId: string) {
  open(previewId, profileId, `${origin}/cookie`)
  const state = await until(`cookie page ${previewId}`, previewId, (candidate) =>
    candidate.title.startsWith('cookie:'),
  )
  views.setBounds(page, previewId, null)
  return state.title.slice('cookie:'.length)
}

async function run() {
  checks.launchPort = launchPort
  views.registerOwner(OWNER_KEY, page)

  // A cookie the previous launch set in the persist:* default profile, read before this launch
  // sets its own: the second probe run proves the profile is kept on disk.
  checks.previousLaunchCookie = await cookieTitle('persisted', PROFILE)
  await views.close(page, 'persisted')

  open('main', PROFILE, `${origin}/a`)
  const first = await until('first page', 'main', loaded(`${origin}/a`))
  record('preview-loaded', { title: first.title })
  checks.firstTitle = first.title

  views.navigate(page, 'main', `${origin}/b`)
  const second = await until(
    'second page',
    'main',
    (state) => loaded(`${origin}/b`)(state) && state.canGoBack,
  )
  checks.secondTitle = second.title
  checks.canGoBack = second.canGoBack

  views.goBack(page, 'main')
  checks.backTitle = (await until('back', 'main', loaded(`${origin}/a`))).title

  checks.zoomFactor = views.zoom(page, 'main', 'in')
  views.setViewport(page, 'main', { mode: 'fixed', width: 390, height: 520, presetId: null })
  await delay(500)
  const shot = await views.captureScreenshot(page, 'main')
  checks.screenshot = {
    width: shot.width,
    height: shot.height,
    bytes: shot.sizeBytes,
    onDisk: existsSync(shot.path) && statSync(shot.path).size === shot.sizeBytes,
  }
  checks.muted = views.setAudioMuted(page, 'main', true).audioMuted

  views.setBounds(page, 'main', null)
  views.setBounds(page, 'main', BOUNDS)

  const value = `launch-${startedAt}`
  checks.cookieValue = value
  const jar = views.profileCookieJar(PROFILE)
  await jar.cookies.set({
    url: `${origin}/`,
    name: COOKIE,
    value,
    path: '/',
    secure: false,
    httpOnly: true,
    sameSite: 'lax',
    expirationDate: Math.floor(Date.now() / 1000) + 86_400,
  })
  await jar.cookies.flushStore()
  checks.setCookieSeen = (await cookieTitle('cookie', PROFILE)) === value
  checks.incognitoCookie = await cookieTitle('incognito', INCOGNITO)

  const cleared = views.profileCookieJar(CLEARED_PROFILE)
  await cleared.cookies.set({
    url: `${origin}/`,
    name: COOKIE,
    value: 'to-clear',
    path: '/',
    secure: false,
    httpOnly: false,
    sameSite: 'lax',
  })
  await cleared.cookies.flushStore()
  checks.beforeClear = await cookieTitle('before-clear', CLEARED_PROFILE)
  await views.close(page, 'before-clear')
  await views.clearProfileData(CLEARED_PROFILE)
  checks.afterClear = await cookieTitle('after-clear', CLEARED_PROFILE)
  checks.defaultAfterClear = await cookieTitle('cookie-after-clear', PROFILE)

  open('pick', PROFILE, `${origin}/pick`)
  await until('pick page', 'pick', loaded(`${origin}/pick`))
  const picker = await probePicker(views, page, 'pick', `${origin}/pick`, launchPort ?? '')
  checks.picker = picker
  await views.close(page, 'pick')

  views.setBounds(page, 'main', BOUNDS)
  await views.close(page, 'main')
  checks.previewsAfterClose = views.ownedPreviewCount(OWNER_KEY)

  return (
    typeof launchPort === 'string' &&
    checks.firstTitle === 'probe-a' &&
    checks.secondTitle === 'probe-b' &&
    checks.canGoBack === true &&
    checks.backTitle === 'probe-a' &&
    shot.width > 0 &&
    shot.height > 0 &&
    checks.muted === true &&
    checks.setCookieSeen === true &&
    checks.incognitoCookie === 'none' &&
    checks.beforeClear === 'to-clear' &&
    checks.afterClear === 'none' &&
    checks.defaultAfterClear === value &&
    checks.previewsAfterClose === 4 &&
    picker.escapedResult === null &&
    picker.elements === 1 &&
    picker.tagName === 'button' &&
    picker.comment === 'Make the probe button primary.' &&
    picker.attachment === 'browser-preview'
  )
}

async function finish(ok: boolean, extra: Record<string, Json> = {}) {
  const result = {
    ok,
    mode: 'adapter',
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
  await views.closeAll()
  fixture.stop(true)
  Utils.quit(ok ? 0 : 1)
}

let started = false
win.webview.on('dom-ready', () => {
  record('shell-dom-ready')
  if (started) return
  started = true
  void run()
    .then((ok) => finish(ok))
    .catch((error: unknown) => finish(false, { error: String(error) }))
})
