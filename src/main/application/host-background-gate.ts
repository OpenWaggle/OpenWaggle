/**
 * When the Session Host may do background work, and when it slims down (A-F9, decision 4).
 *
 * Background passes (Pi session discovery, semantic and transcript projection, term repair) used
 * to start with the Host and compete with the desktop's first ~100 requests. They now wait until
 * a client has been attached for `HOST_BACKGROUND_CLIENT_SETTLE_MS`, and pause while no client is
 * attached. When the last client leaves, the Host slims down after `HOST_IDLE_SLIM_DELAY_MS`: its
 * slim hooks close idle MCP connections, drop the embedding model, and let V8 trim memory.
 *
 * Once open, background work still gives way to clients (W12): between its slices it waits until
 * no client command is in flight and none finished in the last `HOST_FOREGROUND_QUIET_MS`, for
 * at most `HOST_BACKGROUND_MAX_DEFERRAL_MS`. Every slice ran between the statements of the
 * desktop's requests before, and better-sqlite3 runs both on the Host's only thread, so opening a
 * large Session while the term repair ran took 0.7-1.6 s instead of ~250 ms.
 *
 * Until `enable()` (Session Host start), the gate is always open: tests, the CLI, and the desktop
 * process never wait on it.
 */

/** After the first client attaches, its boot requests go first. */
export const HOST_BACKGROUND_CLIENT_SETTLE_MS = 5_000
/** A window reload reconnects within this; a Host left without clients slims after it. */
export const HOST_IDLE_SLIM_DELAY_MS = 2_000
/**
 * A client's next request usually follows its last answer within this: a Session open is a
 * burst of dependent requests with gaps of a few tens of milliseconds between them.
 */
export const HOST_FOREGROUND_QUIET_MS = 50
/** Background work waits for a quiet moment at most this long, so a busy client cannot starve it. */
export const HOST_BACKGROUND_MAX_DEFERRAL_MS = 1_000
/**
 * A command still in flight after this no longer holds background work back: it waits on
 * something else (a model, a process), and an interactive request answers well within it.
 */
export const HOST_FOREGROUND_COMMAND_HOLD_MS = 2_000

export interface HostBackgroundGateClock {
  readonly setTimeout: (callback: () => void, delayMs: number) => { readonly cancel: () => void }
  /** Monotonic milliseconds. */
  readonly elapsedMs: () => number
}

const systemClock: HostBackgroundGateClock = {
  elapsedMs: () => performance.now(),
  setTimeout: (callback, delayMs) => {
    const handle = setTimeout(callback, delayMs)
    handle.unref()
    return { cancel: () => clearTimeout(handle) }
  },
}

type SlimHook = () => void | Promise<void>

interface QuietWaiter {
  readonly resolve: () => void
  readonly deadline: { readonly cancel: () => void }
}

export class HostBackgroundGate {
  private enabled = false
  private clients = 0
  private open = false
  private timer: { readonly cancel: () => void } | undefined
  private waiters: Array<() => void> = []
  private readonly slimHooks = new Set<SlimHook>()
  private slimmed = false
  private readonly foregroundCommands = new Set<{ readonly startedAt: number }>()
  private lastForegroundEndedAt = Number.NEGATIVE_INFINITY
  private quietTimer: { readonly cancel: () => void } | undefined
  private quietWaiters = new Set<QuietWaiter>()

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

  /**
   * A client command (not a long-poll) started; the returned function ends it. Background work
   * waiting in `whenForegroundQuiet` resumes once none is in flight and the Host was quiet a moment.
   */
  foregroundStarted() {
    const command = { startedAt: this.clock.elapsedMs() }
    this.foregroundCommands.add(command)
    this.scheduleQuietCheck()
    return () => {
      if (!this.foregroundCommands.delete(command)) return
      this.lastForegroundEndedAt = Math.max(this.lastForegroundEndedAt, this.clock.elapsedMs())
      this.scheduleQuietCheck()
    }
  }

  get foregroundCommandCount() {
    return this.foregroundCommands.size
  }

  /**
   * Resolves when background work may take its next slice: at once while the gate is not enabled
   * or the clients are quiet, otherwise once they are, or after `HOST_BACKGROUND_MAX_DEFERRAL_MS`.
   */
  whenForegroundQuiet(): Promise<void> {
    if (!this.enabled || this.quietForMs() >= HOST_FOREGROUND_QUIET_MS) return Promise.resolve()
    return new Promise((resolve) => {
      const waiter: QuietWaiter = {
        resolve,
        deadline: this.clock.setTimeout(() => {
          this.quietWaiters.delete(waiter)
          resolve()
        }, HOST_BACKGROUND_MAX_DEFERRAL_MS),
      }
      this.quietWaiters.add(waiter)
      this.scheduleQuietCheck()
    })
  }

  /**
   * Milliseconds the clients have been quiet: since the last command ended, or since the newest
   * held command's hold expired; negative until then, while a held command is in flight.
   */
  private quietForMs() {
    const now = this.clock.elapsedMs()
    let quietSince = this.lastForegroundEndedAt
    for (const command of this.foregroundCommands) {
      quietSince = Math.max(quietSince, command.startedAt + HOST_FOREGROUND_COMMAND_HOLD_MS)
    }
    return now - quietSince
  }

  private scheduleQuietCheck() {
    this.quietTimer?.cancel()
    this.quietTimer = undefined
    if (this.quietWaiters.size === 0) return
    const remaining = Math.max(0, HOST_FOREGROUND_QUIET_MS - this.quietForMs())
    this.quietTimer = this.clock.setTimeout(() => {
      this.quietTimer = undefined
      if (this.quietForMs() < HOST_FOREGROUND_QUIET_MS) {
        this.scheduleQuietCheck()
        return
      }
      const waiters = [...this.quietWaiters]
      this.quietWaiters.clear()
      for (const waiter of waiters) {
        waiter.deadline.cancel()
        waiter.resolve()
      }
    }, remaining)
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
