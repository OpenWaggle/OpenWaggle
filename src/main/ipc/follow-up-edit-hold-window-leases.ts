import { FOLLOW_UP_EDIT_HOLD_RENEW_INTERVAL_MS } from '../domain/session-control/follow-up-edit-lease'

/** One Follow-up edit hold a desktop window began. */
export interface WindowFollowUpEditHold {
  readonly sessionId: string
  readonly followUpId: string
  readonly holdId: string
}

export interface FollowUpEditHoldWindowLeaseDependencies {
  /** Renews a hold with the Host; resolves `false` when the Host no longer has it. */
  readonly renew: (hold: WindowFollowUpEditHold) => Promise<boolean>
  /** Releases a hold with the Host (a Follow-up edit cancel). */
  readonly release: (hold: WindowFollowUpEditHold) => Promise<void>
  /** Calls `onGone` once when the window closes, reloads, navigates away, or crashes. */
  readonly watchWindow: (windowId: number, onGone: () => void) => void
  readonly onError?: (message: string, error: unknown) => void
  /** Repeats `callback` every `ms` until the returned function is called. */
  readonly repeat?: (callback: () => void, ms: number) => () => void
}

function repeatWithTimer(callback: () => void, ms: number) {
  const timer = setInterval(callback, ms)
  timer.unref()
  return () => clearInterval(timer)
}

/**
 * Binds Follow-up edit holds to the desktop window that began them (ADR 0043). The Host owns each
 * hold as a lease that expires unless renewed; this keeps renewing the holds of live windows and
 * releases a window's holds as soon as that window closes or reloads. When the desktop app or its
 * Host connection goes away, renewal stops and the Host lets the leases expire.
 */
export class FollowUpEditHoldWindowLeases {
  private readonly holdsByWindow = new Map<number, Map<string, WindowFollowUpEditHold>>()
  private readonly watchedWindows = new Set<number>()
  private stopRenewal: (() => void) | undefined
  private renewing = false

  constructor(private readonly dependencies: FollowUpEditHoldWindowLeaseDependencies) {}

  /** Starts tracking a hold the window began. Tracking the same hold again is a no-op. */
  track(windowId: number, hold: WindowFollowUpEditHold) {
    this.forget(hold.holdId)
    const holds = this.holdsByWindow.get(windowId) ?? new Map<string, WindowFollowUpEditHold>()
    holds.set(hold.holdId, hold)
    this.holdsByWindow.set(windowId, holds)
    if (!this.watchedWindows.has(windowId)) {
      this.watchedWindows.add(windowId)
      this.dependencies.watchWindow(windowId, () => this.releaseWindow(windowId))
    }
    this.ensureTimer()
  }

  /** Stops tracking a hold that was saved, cancelled, or lost. */
  forget(holdId: string) {
    for (const [windowId, holds] of this.holdsByWindow) {
      if (holds.delete(holdId) && holds.size === 0) this.holdsByWindow.delete(windowId)
    }
    this.stopTimerWhenIdle()
  }

  heldBy(windowId: number): readonly WindowFollowUpEditHold[] {
    return [...(this.holdsByWindow.get(windowId)?.values() ?? [])]
  }

  /** Releases every hold of a window that closed, reloaded, or crashed. */
  releaseWindow(windowId: number) {
    this.watchedWindows.delete(windowId)
    const holds = this.heldBy(windowId)
    this.holdsByWindow.delete(windowId)
    this.stopTimerWhenIdle()
    return Promise.all(
      holds.map((hold) =>
        this.dependencies.release(hold).catch((error: unknown) => {
          // The lease still expires on the Host; this only delays the queue until then.
          this.dependencies.onError?.('A closed window could not release its Follow-up edit', error)
        }),
      ),
    ).then(() => undefined)
  }

  /**
   * Renews every tracked hold once. A hold the Host no longer has stops being tracked and is
   * cancelled, which lets its queue deliver at once instead of waiting for the Host's sweep.
   */
  async renewAll() {
    if (this.renewing) return
    this.renewing = true
    try {
      const holds = [...this.holdsByWindow.values()].flatMap((byHold) => [...byHold.values()])
      await Promise.all(
        holds.map(async (hold) => {
          try {
            if (await this.dependencies.renew(hold)) return
            this.forget(hold.holdId)
            await this.dependencies.release(hold)
          } catch (error) {
            // Keep the hold: a transient Host failure must not end an edit early. If the Host
            // stays unreachable, its lease expires there.
            this.dependencies.onError?.('A Follow-up edit hold could not be renewed', error)
          }
        }),
      )
    } finally {
      this.renewing = false
    }
  }

  dispose() {
    this.holdsByWindow.clear()
    this.stopTimer()
  }

  private ensureTimer() {
    if (this.stopRenewal) return
    const repeat = this.dependencies.repeat ?? repeatWithTimer
    this.stopRenewal = repeat(() => {
      void this.renewAll()
    }, FOLLOW_UP_EDIT_HOLD_RENEW_INTERVAL_MS)
  }

  private stopTimerWhenIdle() {
    if (this.holdsByWindow.size === 0) this.stopTimer()
  }

  private stopTimer() {
    this.stopRenewal?.()
    this.stopRenewal = undefined
  }
}

/**
 * Counts page loads per window. A Follow-up edit begun by a page that has since reloaded, crashed,
 * or closed must be released, not bound to the window's next page, so the begin snapshots the
 * generation before it is sent and the hold is tracked only if the generation is unchanged.
 */
export class WindowPageGenerations {
  private readonly generations = new Map<number, number>()

  constructor(
    /** Subscribes to the window's page changes; `false` when the window is already gone. */
    private readonly watch: (
      windowId: number,
      events: { readonly pageChanged: () => void; readonly destroyed: () => void },
    ) => boolean,
  ) {}

  snapshot(windowId: number): number | undefined {
    const current = this.generations.get(windowId)
    if (current !== undefined) return current
    const watching = this.watch(windowId, {
      pageChanged: () => {
        this.generations.set(windowId, (this.generations.get(windowId) ?? 0) + 1)
      },
      destroyed: () => {
        this.generations.delete(windowId)
      },
    })
    if (!watching) return undefined
    this.generations.set(windowId, 0)
    return 0
  }

  isCurrent(windowId: number, generation: number | undefined) {
    return generation !== undefined && this.generations.get(windowId) === generation
  }
}
