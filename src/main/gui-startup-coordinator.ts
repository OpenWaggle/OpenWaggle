/**
 * The desktop window's startup state machine (A-F2, maintainer decision 3).
 *
 * One attempt at a time brings the backend up: attach to or launch the Session Host, hydrate
 * Settings, start desktop services. The window shows a skeleton while the state is `starting`,
 * "Finishing an update…" while the Host hands over to an update, and an error screen with Retry
 * and Open logs once an attempt fails or has not finished after `slowAfterMs`. An attempt that
 * finishes after the deadline still makes the window ready. Retry starts a new attempt; one that
 * is still running past its deadline is aborted first, since a Host that died while starting
 * would otherwise keep it waiting for minutes. The new attempt starts only once the aborted one
 * has settled: both would share this process's one Host attachment, renderer bridge and desktop
 * services, so an aborted attempt that unwinds late would detach the new one. An aborted attempt
 * that got past its last abort check before it noticed still makes the window ready.
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

/** How an attempt settled. */
type AttemptOutcome =
  | { readonly kind: 'ready' }
  | { readonly kind: 'failed'; readonly error: unknown }

interface Attempt {
  readonly controller: AbortController
  /** Settles once the attempt has; it never rejects. */
  readonly settled: Promise<AttemptOutcome>
}

const NO_PREVIOUS_ATTEMPT: Promise<AttemptOutcome> = Promise.resolve({
  kind: 'failed',
  error: null,
})

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
  let attempt: Attempt | null = null
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

  /** Starts an attempt once `previous` (an aborted one) has settled, adopting its success. */
  const begin = (previous: Promise<AttemptOutcome> = NO_PREVIOUS_ATTEMPT) => {
    restartRequired = false
    if (current.state !== 'starting') publish({ state: 'starting' })
    armDeadline()
    const controller = new AbortController()
    // Only the latest attempt may change the state; an aborted one settles unheard.
    const isCurrent = () => attempt?.controller === controller
    const settled = previous
      .then((outcome) => {
        // It got past its last abort check, so the backend is up: starting again would attach twice.
        if (outcome.kind === 'ready') return
        // It left nothing to retry in place; this attempt cannot either.
        if (outcome.error instanceof GuiStartupRestartRequiredError) throw outcome.error
        controller.signal.throwIfAborted()
        return input.start(progress, controller.signal)
      })
      .then(
        (): AttemptOutcome => {
          if (isCurrent()) {
            attempt = null
            clearDeadline()
            publish({ state: 'ready' })
          }
          return { kind: 'ready' }
        },
        (error: unknown): AttemptOutcome => {
          if (isCurrent()) {
            attempt = null
            clearDeadline()
            restartRequired = error instanceof GuiStartupRestartRequiredError
            input.onFailure(error instanceof GuiStartupRestartRequiredError ? error.failure : error)
            publish({ state: 'failed', reason: 'error', message: input.describeFailure(error) })
          }
          return { kind: 'failed', error }
        },
      )
    attempt = { controller, settled }
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
        begin(attempt.settled)
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
