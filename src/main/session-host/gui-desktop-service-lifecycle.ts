export interface GuiDesktopServiceLifecycle {
  readonly stop: () => Promise<void>
  /** `stopped` never reattaches; `reconnecting` is the pump still retrying in the background. */
  readonly attachment: () => 'attached' | 'reconnecting' | 'stopped'
  /** Invoke only after actual native PTY/browser disposal has succeeded. */
  readonly markClosed: () => Promise<void>
}

export class DesktopNativeQuarantinedError extends Error {
  readonly code = 'desktop_native_quarantined'
  readonly reason = 'previous-owner-unclean'

  constructor() {
    super(
      'Desktop tools are paused because a previous GUI did not confirm native resource cleanup. Sessions remain available.',
    )
    this.name = 'DesktopNativeQuarantinedError'
  }
}

const HOST_RESTART_HINT =
  'If this keeps happening, quit OpenWaggle, run openwaggle host stop --wait in a terminal, and reopen it.'

/** The Host did not accept a user-attested recovery; the bridge stops instead of retrying it. */
export class DesktopNativeRecoveryError extends Error {
  constructor(cause: unknown) {
    const reason =
      cause instanceof Error ? cause.message : 'the Session Host did not accept the request.'
    // The advice leads: a Host that predates recovery answers with a long schema decode error.
    super(`Desktop tools could not be recovered. ${HOST_RESTART_HINT} Reason: ${reason}`, { cause })
    this.name = 'DesktopNativeRecoveryError'
  }
}

export class DesktopServiceAttachmentError extends Error {
  constructor(
    readonly lifecycle: GuiDesktopServiceLifecycle,
    cause: unknown,
  ) {
    super(
      'Could not attach desktop services. Native cleanup must finish before releasing desktop ownership.',
      { cause },
    )
    this.name = 'DesktopServiceAttachmentError'
  }
}

export const DESKTOP_SHUTDOWN_DRAIN_MS = 30_000
export const DESKTOP_BRIDGE_TICK_MS = 100

export function desktopBridgeDelay(milliseconds: number, signal?: AbortSignal) {
  if (signal?.aborted) return Promise.resolve()
  return new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', done)
      resolve()
    }
    const timer = setTimeout(done, milliseconds)
    timer.unref?.()
    signal?.addEventListener('abort', done, { once: true })
  })
}

export async function withDesktopShutdownDeadline<A>(operation: Promise<A>, deadline: number) {
  const timeout = Promise.withResolvers<never>()
  const timer = setTimeout(
    () =>
      timeout.reject(
        new Error(
          'Desktop mutations did not drain before shutdown. Wait for them to finish and try again.',
        ),
      ),
    Math.max(1, deadline - Date.now()),
  )
  timer.unref?.()
  try {
    return await Promise.race([operation, timeout.promise])
  } finally {
    clearTimeout(timer)
  }
}

import type { DesktopServiceRequest, DesktopServiceResponse } from '@shared/types/desktop-service'
import type { GuiDesktopServiceExecutor } from './gui-desktop-service-executor'
import type { LocalSessionHostPaths } from './local-session-paths'

export interface GuiDesktopBridgeInput {
  readonly client: { readonly paths: LocalSessionHostPaths; readonly clientVersion: string }
  readonly executor: GuiDesktopServiceExecutor
  readonly request?: (request: DesktopServiceRequest) => Promise<DesktopServiceResponse>
  /** The user attested that the previous unclean desktop left nothing running. Sent once. */
  readonly recoverPreviousOwner?: boolean
}

/**
 * Register, or for a recovering bridge send the user's attestation in its place (ADR 0048). Any
 * failure before the Host accepts that attestation is terminal, so a retry never replays it.
 */
export async function registerGuiDesktop(input: {
  readonly request: (request: DesktopServiceRequest) => Promise<DesktopServiceResponse>
  readonly refresh: () => Promise<void>
  readonly guiInstanceId: string
  readonly recovering: boolean
}) {
  let registered: DesktopServiceResponse
  try {
    await input.refresh()
    registered = await input.request({
      operation: input.recovering ? 'recoverOwner' : 'register',
      guiInstanceId: input.guiInstanceId,
    })
  } catch (error) {
    throw input.recovering ? new DesktopNativeRecoveryError(error) : error
  }
  if (registered.operation === 'quarantined') {
    throw input.recovering
      ? new DesktopNativeRecoveryError(undefined)
      : new DesktopNativeQuarantinedError()
  }
  if (registered.operation !== 'register') {
    const unacknowledged = new Error('Desktop registration was not acknowledged.')
    throw input.recovering ? new DesktopNativeRecoveryError(unacknowledged) : unacknowledged
  }
  return registered
}
