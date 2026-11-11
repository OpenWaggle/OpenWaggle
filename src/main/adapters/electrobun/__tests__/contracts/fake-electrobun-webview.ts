import type { EventEmitter } from 'node:events'
import { structuredTransport } from '@shared/structured-wire'

/**
 * Fakes of Electrobun's windows and webviews for the webview cluster's contract runners:
 * `BrowserWindow` (with its webview), `BrowserView` and its typed RPC. The RPC follows
 * Electrobun's `createRPC` packet semantics (`.hutch/devkit/api/shared/rpc.ts`): a request
 * answers `{ success, payload }` or `{ success: false, error: message }`, a message carries a
 * payload, and a request times out with "RPC request timed out.". Each webview has a fake page at
 * the other end of its RPC, which answers heartbeats while it lives, records the events it
 * receives, and can invoke and send like the preload does. Packets cross as JSON, as on the wire.
 */
export interface RpcConfig {
  readonly maxRequestTime?: number
  readonly handlers: {
    readonly requests?: Readonly<Record<string, (params: unknown) => unknown>>
    readonly messages?: Readonly<Record<string, (payload: unknown) => void>>
  }
}

export interface PacketTransport {
  readonly send?: (packet: unknown) => void
  readonly registerHandler?: (handler: (packet: unknown) => void) => void
}

interface Packet {
  readonly type?: unknown
  readonly id?: unknown
  readonly method?: unknown
  readonly params?: unknown
  readonly payload?: unknown
  readonly success?: unknown
  readonly error?: unknown
}

const DEFAULT_MAX_REQUEST_TIME = 1000

function asPacket(value: unknown): Packet {
  return typeof value === 'object' && value !== null ? value : {}
}

/** Electrobun's RPC object, as `BrowserView.defineRPC` and `Electroview.defineRPC` make it. */
export function fakeRpc(config: RpcConfig) {
  let transport: PacketTransport = {}
  let nextId = 1
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()

  function receive(raw: unknown) {
    const packet = asPacket(raw)
    if (packet.type === 'request' && typeof packet.method === 'string') {
      const id = packet.id
      const handler = config.handlers.requests?.[packet.method]
      void Promise.resolve()
        .then(() => {
          if (!handler) {
            throw new Error(`The requested method has no handler: ${String(packet.method)}`)
          }
          return handler(packet.params)
        })
        .then(
          (payload) => transport.send?.({ type: 'response', id, success: true, payload }),
          (error: unknown) =>
            transport.send?.({
              type: 'response',
              id,
              success: false,
              error: error instanceof Error ? error.message : String(error),
            }),
        )
      return
    }
    if (packet.type === 'response' && typeof packet.id === 'number') {
      const listener = pending.get(packet.id)
      pending.delete(packet.id)
      if (packet.success === true) listener?.resolve(packet.payload)
      else listener?.reject(new Error(String(packet.error)))
      return
    }
    if (packet.type === 'message' && typeof packet.id === 'string') {
      config.handlers.messages?.[packet.id]?.(packet.payload)
    }
  }

  return {
    setTransport: (next: PacketTransport) => {
      transport = next
      next.registerHandler?.(receive)
    },
    request: (method: string, params?: unknown, options?: { readonly maxRequestTime?: number }) =>
      new Promise<unknown>((resolve, reject) => {
        const id = nextId++
        pending.set(id, { resolve, reject })
        const limit = options?.maxRequestTime ?? config.maxRequestTime ?? DEFAULT_MAX_REQUEST_TIME
        if (limit !== Infinity) {
          setTimeout(() => {
            if (!pending.delete(id)) return
            reject(new Error('RPC request timed out.'))
          }, limit)
        }
        transport.send?.({ type: 'request', id, method, params })
      }),
    send: (message: string, payload?: unknown) =>
      transport.send?.({ type: 'message', id: message, payload }),
  }
}

/** JSON in, JSON out, as Electrobun's socket and evaluate bridges carry packets. */
function overTheWire(packet: unknown): unknown {
  return JSON.parse(JSON.stringify(packet))
}

/** The page at the far end of a webview's RPC, as the Electrobun preload sets it up. */
export class FakePage {
  alive = true
  readonly received: { readonly channel: string; readonly args: readonly unknown[] }[] = []
  private toHost: (packet: unknown) => void = () => undefined
  private fromHost: (packet: unknown) => void = () => undefined
  readonly rpc = fakeRpc({
    maxRequestTime: Infinity,
    handlers: {
      // A page whose web process died never answers.
      requests: { 'shell:heartbeat': () => (this.alive ? true : new Promise(() => undefined)) },
      messages: {
        'shell:event': (payload) => {
          const event = asPacket(payload)
          const channel: unknown = Reflect.get(event, 'channel')
          const args: unknown = Reflect.get(event, 'args')
          if (typeof channel === 'string' && Array.isArray(args)) {
            this.received.push({ channel, args })
          }
        },
      },
    },
  })

  constructor() {
    this.rpc.setTransport(
      structuredTransport({
        send: (packet) => this.toHost(overTheWire(packet)),
        registerHandler: (handler) => {
          this.fromHost = handler
        },
      }),
    )
  }

  /** The host side of the webview transport (`BrowserView.createTransport()`). */
  hostTransport(): PacketTransport {
    return {
      send: (packet) => this.fromHost(overTheWire(packet)),
      registerHandler: (handler) => {
        this.toHost = handler
      },
    }
  }

  invoke(channel: string, ...args: unknown[]) {
    return this.rpc.request('shell:invoke', { channel, args }, { maxRequestTime: Infinity })
  }

  send(channel: string, ...args: unknown[]) {
    this.rpc.send('shell:send', { channel, args })
  }
}

export interface ViewOptions {
  readonly url?: string | null
  readonly rpc?: { readonly setTransport: (transport: PacketTransport) => void }
  readonly windowId?: number
  readonly navigationRules?: string | null
  readonly preload?: string | null
}

export interface WindowOptions extends ViewOptions {
  readonly hidden?: boolean
  readonly title?: string
}

export interface FakeWebviewHooks {
  /** A window was brought to the front (`activate`, `focus`, `show`). */
  readonly onRaise?: (windowId: number) => void
}

export function fakeElectrobunWebview(events: EventEmitter, hooks: FakeWebviewHooks = {}) {
  let nextViewId = 100
  let nextWindowId = 1
  const views = new Map<number, FakeBrowserView>()
  const windows = new Map<number, FakeBrowserWindow>()
  const windowState: { focusedId: number | null } = { focusedId: null }

  class FakeBrowserView {
    readonly id = nextViewId++
    readonly windowId: number
    readonly page = new FakePage()
    readonly executed: string[] = []
    devToolsToggles = 0
    readonly loaded: string[] = []
    readonly options: ViewOptions
    url: string | null
    removed = false

    constructor(options: ViewOptions) {
      this.options = options
      this.windowId = options.windowId ?? 0
      this.url = options.url ?? null
      views.set(this.id, this)
    }
    static defineRPC(config: RpcConfig) {
      return fakeRpc(config)
    }
    static getById(id: number) {
      return views.get(id)
    }
    createTransport = () => this.page.hostTransport()
    on(name: string, handler: (event: unknown) => void) {
      events.on(`${name}-${String(this.id)}`, handler)
    }
    executeJavascript(js: string) {
      this.executed.push(js)
    }
    toggleDevTools() {
      this.devToolsToggles += 1
    }
    loadURL(url: string) {
      this.loaded.push(url)
      this.url = url
    }
    remove() {
      this.removed = true
      views.delete(this.id)
    }
    /** Electrobun reports a webview event: `{ data: { detail } }` under `<name>-<id>`. */
    emitEvent(name: string, detail: unknown) {
      events.emit(`${name}-${String(this.id)}`, { name, data: { detail } })
    }
  }

  class FakeBrowserWindow {
    readonly id = nextWindowId++
    readonly webviewId: number
    readonly options: WindowOptions
    visible: boolean
    minimized = false
    fullScreen = false

    constructor(options: WindowOptions) {
      this.options = options
      this.visible = options.hidden !== true
      windows.set(this.id, this)
      this.webviewId = new FakeBrowserView({ ...options, windowId: this.id }).id
      options.rpc?.setTransport(this.webview.createTransport())
    }
    static getById(id: number) {
      return windows.get(id)
    }
    get webview() {
      const view = views.get(this.webviewId)
      if (!view) throw new Error(`No webview ${String(this.webviewId)}`)
      return view
    }
    on(name: string, handler: (event: unknown) => void) {
      events.on(`${name}-${String(this.id)}`, handler)
    }
    show() {
      this.visible = true
      this.activate()
    }
    showInactive() {
      this.visible = true
    }
    activate() {
      this.visible = true
      this.minimized = false
      hooks.onRaise?.(this.id)
      windowState.focusedId = this.id
      events.emit(`focus-${String(this.id)}`, { name: 'focus', data: { id: this.id } })
    }
    focus() {
      this.activate()
    }
    isVisible() {
      return this.visible
    }
    minimize() {
      this.minimized = true
      if (windowState.focusedId === this.id) {
        windowState.focusedId = null
        events.emit(`blur-${String(this.id)}`, { name: 'blur', data: { id: this.id } })
      }
    }
    unminimize() {
      this.minimized = false
    }
    isMinimized() {
      return this.minimized
    }
    isFullScreen() {
      return this.fullScreen
    }
    setTitle() {
      return undefined
    }
    close() {
      windows.delete(this.id)
      for (const view of [...views.values()]) if (view.windowId === this.id) view.remove()
      const event = { name: 'close', data: { id: this.id } }
      events.emit(`close-${String(this.id)}`, event)
      events.emit('close', event)
    }
  }

  return {
    module: { BrowserWindow: FakeBrowserWindow, BrowserView: FakeBrowserView },
    views,
    windows,
    windowState,
    webviewOf: (id: number) => {
      const view = views.get(id)
      if (!view) throw new Error(`No webview ${String(id)}`)
      return view
    },
  }
}
