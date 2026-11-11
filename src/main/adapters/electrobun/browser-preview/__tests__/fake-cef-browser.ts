import { decodeUnknownOrThrow, parseJsonUnknown, Schema } from '@shared/schema'
import type { CdpSocket, CdpSocketFactory } from '../cdp-connection'
import { CefDevToolsEndpoint } from '../cef-devtools-endpoint'
import type { ElectrobunPreviewView } from '../electrobun-preview-guest'

/** A 2x3 PNG: signature plus an IHDR header, which is all the preview reads. */
export const FAKE_PNG = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 2,
  0, 0, 0, 3, 8, 6, 0, 0, 0,
])

const CommandSchema = Schema.Struct({
  id: Schema.Number,
  method: Schema.String,
  params: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
})

type CommandParams = Readonly<Record<string, unknown>>

function stringParam(params: CommandParams, name: string) {
  const value = params[name]
  if (typeof value !== 'string') throw new Error(`Expected a string ${name}`)
  return value
}

interface FakePage {
  readonly targetId: string
  readonly view: FakeCefView
  history: { id: number; url: string }[]
  index: number
  socket: FakeCdpSocket | null
  title: string
}

type Listener = (event: { readonly data: unknown }) => void

class FakeCdpSocket implements CdpSocket {
  private readonly listeners = new Map<string, Listener[]>()
  closed = false

  private readonly onCommand: (message: string) => void

  constructor(onCommand: (message: string) => void) {
    this.onCommand = onCommand
    queueMicrotask(() => this.dispatch('open'))
  }

  addEventListener(type: string, listener: Listener) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener])
  }

  send(data: string) {
    this.onCommand(data)
  }

  close() {
    if (this.closed) return
    this.closed = true
    this.dispatch('close')
  }

  deliver(message: object) {
    if (!this.closed) this.dispatch('message', { data: JSON.stringify(message) })
  }

  private dispatch(type: string, event: { readonly data: unknown } = { data: undefined }) {
    for (const listener of this.listeners.get(type) ?? []) listener(event)
  }
}

export class FakeCefView implements ElectrobunPreviewView {
  removed = false
  devToolsOpened = 0
  readonly loadedUrls: string[] = []
  readonly id: number

  readonly options: {
    readonly windowId: number
    readonly url: string
    readonly partition: string
  }

  constructor(
    id: number,
    options: {
      readonly windowId: number
      readonly url: string
      readonly partition: string
    },
  ) {
    this.id = id
    this.options = options
  }

  loadURL(url: string) {
    this.loadedUrls.push(url)
  }

  remove() {
    this.removed = true
  }

  openDevTools() {
    this.devToolsOpened += 1
  }
}

/**
 * A CEF browser process as the preview sees it through its DevTools endpoint: one page target per
 * view, each answering the CDP commands the preview sends and reporting navigations as CEF does.
 */
export function fakeCefBrowser(port = 9555) {
  const pages = new Map<string, FakePage>()
  const commands: {
    readonly targetId: string
    readonly method: string
    readonly params: CommandParams
  }[] = []
  const failing = new Set<string>()
  let nextViewId = 100
  let nextEntryId = 1

  const event = (page: FakePage, method: string, params: object) =>
    page.socket?.deliver({ method, params })

  function commit(page: FakePage, url: string) {
    event(page, 'Page.frameStartedLoading', { frameId: 'main' })
    event(page, 'Page.frameNavigated', { frame: { id: 'main', url } })
    event(page, 'Page.frameStoppedLoading', { frameId: 'main' })
  }

  function navigate(page: FakePage, url: string) {
    page.history = [...page.history.slice(0, page.index + 1), { id: nextEntryId++, url }]
    page.index = page.history.length - 1
    commit(page, url)
  }

  const answers = new Map<string, (page: FakePage, params: CommandParams) => object>([
    ['Page.addScriptToEvaluateOnNewDocument', () => ({ identifier: 'script-1' })],
    [
      'Page.getFrameTree',
      (page) => ({
        frameTree: { frame: { id: 'main', url: page.history[page.index]?.url ?? '' } },
      }),
    ],
    [
      'Page.navigate',
      (page, params) => {
        const url = stringParam(params, 'url')
        queueMicrotask(() => navigate(page, url))
        return { frameId: 'main' }
      },
    ],
    ['Page.getNavigationHistory', (page) => ({ currentIndex: page.index, entries: page.history })],
    [
      'Page.navigateToHistoryEntry',
      (page, params) => {
        const index = page.history.findIndex((entry) => entry.id === params['entryId'])
        const entry = page.history[index]
        if (entry === undefined) throw new Error('No such history entry')
        page.index = index
        queueMicrotask(() => commit(page, entry.url))
        return {}
      },
    ],
    ['Page.captureScreenshot', () => ({ data: Buffer.from(FAKE_PNG).toString('base64') })],
    ['Network.setCookie', () => ({ success: true })],
    ['Network.getAllCookies', () => ({ cookies: [{ domain: '.example.com' }] })],
  ])

  function connect(targetId: string) {
    const page = pages.get(targetId)
    if (page === undefined) throw new Error(`No page ${targetId}`)
    const socket = new FakeCdpSocket((data) => {
      const { id, method, params } = decodeUnknownOrThrow(CommandSchema, parseJsonUnknown(data))
      commands.push({ targetId, method, params })
      queueMicrotask(() => {
        if (failing.has(method)) {
          socket.deliver({ id, error: { message: `${method} failed` } })
          return
        }
        socket.deliver({ id, result: answers.get(method)?.(page, params) ?? {} })
      })
    })
    page.socket = socket
    return socket
  }

  const openSocket: CdpSocketFactory = (url) => {
    const match = /\/devtools\/page\/(.+)$/.exec(url)
    if (match?.[1] === undefined) throw new Error(`Unexpected socket URL ${url}`)
    return connect(match[1])
  }

  const endpoint = new CefDevToolsEndpoint(port, async () => ({
    ok: true,
    status: 200,
    text: async () =>
      JSON.stringify(
        [...pages.values()]
          .filter((page) => !page.view.removed)
          .map((page) => ({
            id: page.targetId,
            type: 'page',
            url: page.history[page.index]?.url ?? '',
            webSocketDebuggerUrl: `ws://127.0.0.1:${String(port)}/devtools/page/${page.targetId}`,
          })),
      ),
  }))

  function createView(options: { windowId: number; url: string; partition: string }) {
    const view = new FakeCefView(nextViewId++, options)
    const targetId = `target-${String(view.id)}`
    pages.set(targetId, {
      targetId,
      view,
      history: [{ id: nextEntryId++, url: options.url }],
      index: 0,
      socket: null,
      title: '',
    })
    return view
  }

  function pageOf(view: { readonly id: number }) {
    const page = [...pages.values()].find((candidate) => candidate.view.id === view.id)
    if (page === undefined) throw new Error(`No page for view ${String(view.id)}`)
    return page
  }

  return {
    endpoint,
    openSocket,
    createView,
    commands,
    failing,
    views: () => [...pages.values()].map((page) => page.view),
    pageOf,
    /** Sends a CDP event to the page of `view`. */
    emit: (view: { readonly id: number }, method: string, params: object) =>
      event(pageOf(view), method, params),
    sent: (method: string) => commands.filter((command) => command.method === method),
  }
}
