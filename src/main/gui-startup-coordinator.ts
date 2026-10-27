/**
 * The desktop window's startup state machine (A-F2, maintainer decision 3).
 *
 * One attempt at a time brings the backend up: attach to or launch the Session Host, hydrate
 * Settings, start desktop services. The window shows a skeleton while the state is `starting`,
 * "Finishing an update…" while the Host hands over to an update, and an error screen with Retry
 * and Open logs once an attempt fails or has not finished after `slowAfterMs`. An attempt that
 * finishes after the deadline still makes the window ready. Retry starts a new attempt; one that
 * is still running past its deadline is aborted first, since a Host that died while starting
 * would otherwise keep it waiting for minutes.
 */
import { GUI_STARTUP_SLOW_AFTER_MS, type GuiStartupStatus } from '@shared/types/gui-startup'

export const GUI_STARTUP_TIMEOUT_MESSAGE =
  'The Session Host did not start in time. It may still be starting.'

/** Thrown by a start whose failure left this process unable to retry it in place. */
export class GuiStartupRestartRequiredError extends Error {
  constructor(readonly failure: unknown) {
    super(failure instanceof Error ? failure.message : String(failure), { cause: failure })
    this.name = 'GuiStartupRestartRequiredError'
  }
}

export interface GuiStartupProgress {
  /** The running Host is handing over to an update; the deadline does not apply meanwhile. */
  readonly updating: () => void
}

export interface GuiStartupCoordinatorInput {
  readonly start: (progress: GuiStartupProgress, signal: AbortSignal) => Promise<void>
  readonly publish: (status: GuiStartupStatus) => void
  /** Logs and reports a failed attempt; its return value is ignored. */
  readonly onFailure: (error: unknown) => void
  /** How the error screen's message names a failure; it must already be redacted. */
  readonly describeFailure: (error: unknown) => string
  /** Retry after a failure that `start` marked as needing a fresh process. */
  readonly restart: () => void
  readonly slowAfterMs?: number
  readonly setTimer?: (callback: () => void, milliseconds: number) => () => void
}

export interface GuiStartupCoordinator {
  readonly run: () => void
  readonly retry: () => void
  readonly status: () => GuiStartupStatus
}

function defaultSetTimer(callback: () => void, milliseconds: number) {
  const timer = setTimeout(callback, milliseconds)
  return () => clearTimeout(timer)
}

export function createGuiStartupCoordinator(
  input: GuiStartupCoordinatorInput,
): GuiStartupCoordinator {
  const setTimer = input.setTimer ?? defaultSetTimer
  const slowAfterMs = input.slowAfterMs ?? GUI_STARTUP_SLOW_AFTER_MS
  let current: GuiStartupStatus = { state: 'starting' }
  let attempt: { readonly controller: AbortController } | null = null
  let cancelDeadline: (() => void) | null = null
  let restartRequired = false

  const publish = (next: GuiStartupStatus) => {
    current = next
    input.publish(next)
  }
  const clearDeadline = () => {
    cancelDeadline?.()
    cancelDeadline = null
  }
  const armDeadline = () => {
    clearDeadline()
    cancelDeadline = setTimer(() => {
      cancelDeadline = null
      if (current.state !== 'starting') return
      publish({ state: 'failed', reason: 'timeout', message: GUI_STARTUP_TIMEOUT_MESSAGE })
    }, slowAfterMs)
  }

  const progress: GuiStartupProgress = {
    updating: () => {
      if (current.state === 'ready' || current.state === 'updating') return
      clearDeadline()
      publish({ state: 'updating' })
    },
  }

  const begin = () => {
    restartRequired = false
    if (current.state !== 'starting') publish({ state: 'starting' })
    armDeadline()
    const running = { controller: new AbortController() }
    attempt = running
    // Only the latest attempt may change the state; an aborted one settles unheard.
    const isCurrent = () => attempt === running
    void Promise.resolve()
      .then(() => input.start(progress, running.controller.signal))
      .then(
        () => {
          if (!isCurrent()) return
          attempt = null
          clearDeadline()
          publish({ state: 'ready' })
        },
        (error: unknown) => {
          if (!isCurrent()) return
          attempt = null
          clearDeadline()
          restartRequired = error instanceof GuiStartupRestartRequiredError
          input.onFailure(error instanceof GuiStartupRestartRequiredError ? error.failure : error)
          publish({ state: 'failed', reason: 'error', message: input.describeFailure(error) })
        },
      )
  }

  return {
    run: () => {
      if (attempt || current.state === 'ready') return
      begin()
    },
    retry: () => {
      if (current.state === 'ready') return
      if (attempt) {
        // Only a late attempt is shown as failed; the user saw it and asked for a new one.
        if (current.state !== 'failed') return
        attempt.controller.abort(new Error('Startup was retried.'))
        attempt = null
        begin()
        return
      }
      if (restartRequired) {
        input.restart()
        return
      }
      begin()
    },
    status: () => current,
  }
}
