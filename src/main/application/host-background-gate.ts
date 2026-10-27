/**
 * When the Session Host may do background work, and when it slims down (A-F9, decision 4).
 *
 * Background passes (Pi session discovery, semantic and transcript projection, term repair) used
 * to start with the Host and compete with the desktop's first ~100 requests. They now wait until
 * a client has been attached for `HOST_BACKGROUND_CLIENT_SETTLE_MS`, and pause while no client is
 * attached. When the last client leaves, the Host slims down after `HOST_IDLE_SLIM_DELAY_MS`: its
 * slim hooks close idle MCP connections, drop the embedding model, and let V8 trim memory.
 *
 * Until `enable()` (Session Host start), the gate is always open: tests, the CLI, and the desktop
 * process never wait on it.
 */

/** After the first client attaches, its boot requests go first. */
export const HOST_BACKGROUND_CLIENT_SETTLE_MS = 5_000
/** A window reload reconnects within this; a Host left without clients slims after it. */
export const HOST_IDLE_SLIM_DELAY_MS = 2_000

export interface HostBackgroundGateClock {
  readonly setTimeout: (callback: () => void, delayMs: number) => { readonly cancel: () => void }
}

const systemClock: HostBackgroundGateClock = {
  setTimeout: (callback, delayMs) => {
    const handle = setTimeout(callback, delayMs)
    handle.unref()
    return { cancel: () => clearTimeout(handle) }
  },
}

type SlimHook = () => void | Promise<void>

export class HostBackgroundGate {
  private enabled = false
  private clients = 0
  private open = false
  private timer: { readonly cancel: () => void } | undefined
  private waiters: Array<() => void> = []
  private readonly slimHooks = new Set<SlimHook>()
  private slimmed = false

  constructor(
    private readonly clock: HostBackgroundGateClock = systemClock,
    private readonly onSlimFailed: (error: unknown) => void = () => undefined,
  ) {}

  /** The Session Host gates its background work from now on; nothing runs until a client. */
  enable() {
    if (this.enabled) return
    this.enabled = true
    this.open = false
    if (this.clients > 0) this.scheduleOpen()
  }

  get isOpen() {
    return !this.enabled || this.open
  }

  /** Resolves once background work may run. */
  whenOpen(): Promise<void> {
    if (this.isOpen) return Promise.resolve()
    return new Promise((resolve) => this.waiters.push(resolve))
  }

  /** An authenticated client attached; the returned function detaches it. */
  clientAttached() {
    this.clients += 1
    this.slimmed = false
    if (this.clients === 1 && this.enabled) this.scheduleOpen()
    let released = false
    return () => {
      if (released) return
      released = true
      this.clients -= 1
      if (this.clients === 0) this.clientsLeft()
    }
  }

  /** Work to do when the Host is left without clients. Returns the function that removes it. */
  onSlim(hook: SlimHook) {
    this.slimHooks.add(hook)
    return () => {
      this.slimHooks.delete(hook)
    }
  }

  get attachedClients() {
    return this.clients
  }

  private scheduleOpen() {
    this.timer?.cancel()
    this.timer = this.clock.setTimeout(() => {
      this.timer = undefined
      if (this.clients === 0) return
      this.open = true
      for (const resolve of this.waiters.splice(0)) resolve()
    }, HOST_BACKGROUND_CLIENT_SETTLE_MS)
  }

  private clientsLeft() {
    this.timer?.cancel()
    if (!this.enabled) return
    this.open = false
    this.timer = this.clock.setTimeout(() => {
      this.timer = undefined
      if (this.clients > 0 || this.slimmed) return
      this.slimmed = true
      for (const hook of this.slimHooks) {
        try {
          void Promise.resolve(hook()).catch(this.onSlimFailed)
        } catch (error) {
          this.onSlimFailed(error)
        }
      }
    }, HOST_IDLE_SLIM_DELAY_MS)
  }
}

/** The Session Host's gate. */
export const hostBackgroundGate = new HostBackgroundGate()
