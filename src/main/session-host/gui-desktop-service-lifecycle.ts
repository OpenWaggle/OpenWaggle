export interface GuiDesktopServiceLifecycle {
  readonly stop: () => Promise<void>
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
}
