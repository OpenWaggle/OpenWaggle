import type { BackgroundRunSnapshot } from '@shared/types/background-run'
import { LOCAL_SESSION_CURRENT_REVISION } from '@shared/types/local-session-protocol'
import type { Logger } from '@shared/types/logger'
import type { SessionHostEventEnvelope } from '@shared/types/session-host-event'
import type { watchLocalSessionEvents } from './local-session-client'
import { LocalSessionClientProtocolError } from './local-session-client-protocol-error'
import type { ensureLocalSessionHost } from './local-session-host-launcher'
import type { LocalSessionHostPaths } from './local-session-paths'

const REMOTE_RECONNECT_DELAY_MS = 250
const REMOTE_RECOVERY_MAX_DELAY_MS = 4_000
const REMOTE_RECOVERY_BACKOFF_FACTOR = 2
const REMOTE_RECOVERY_MAX_BACKOFF_EXPONENT = Math.ceil(
  Math.log(REMOTE_RECOVERY_MAX_DELAY_MS / REMOTE_RECONNECT_DELAY_MS) /
    Math.log(REMOTE_RECOVERY_BACKOFF_FACTOR),
)

class RemoteSessionHostSubscriptionClosedError extends Error {
  constructor() {
    super('Remote Session Host closed the renderer subscription.')
    this.name = 'RemoteSessionHostSubscriptionClosedError'
  }
}

export interface RemoteSessionHostRendererBridgeDependencies {
  readonly watch: typeof watchLocalSessionEvents
  readonly ensure: (input: Parameters<typeof ensureLocalSessionHost>[0]) => Promise<unknown>
  readonly wait: (milliseconds: number, signal?: AbortSignal) => Promise<void>
  readonly logger: Pick<Logger, 'warn' | 'error'>
}

interface RemoteSessionHostRendererPumpHandlers {
  readonly onSnapshot: (snapshots: readonly BackgroundRunSnapshot[]) => void
  readonly onResyncRequired: (reason: string) => void
  readonly onEvent: (event: SessionHostEventEnvelope) => void
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function isTerminalRendererFailure(error: unknown) {
  return error instanceof LocalSessionClientProtocolError && error.retryable === false
}

function awaitWithSignal<T>(operation: Promise<T>, signal: AbortSignal) {
  signal.throwIfAborted()
  return new Promise<T>((resolve, reject) => {
    let settled = false
    const abort = () => {
      if (settled) return
      settled = true
      reject(signal.reason)
    }
    const finish = (settle: () => void) => {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', abort)
      settle()
    }
    operation.then(
      (value) => finish(() => resolve(value)),
      (error: unknown) => finish(() => reject(error)),
    )
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
  })
}

function remoteRecoveryDelay(attempt: number) {
  const exponent = Math.min(Math.max(0, attempt - 1), REMOTE_RECOVERY_MAX_BACKOFF_EXPONENT)
  return Math.min(
    REMOTE_RECONNECT_DELAY_MS * REMOTE_RECOVERY_BACKOFF_FACTOR ** exponent,
    REMOTE_RECOVERY_MAX_DELAY_MS,
  )
}

function waitWithTimer(milliseconds: number, signal: AbortSignal) {
  signal.throwIfAborted()
  return new Promise<void>((resolve, reject) => {
    let settled = false
    const finish = (settle: () => void) => {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', abort)
      settle()
    }
    const timer = setTimeout(() => finish(resolve), milliseconds)
    const abort = () => {
      clearTimeout(timer)
      finish(() => reject(signal.reason))
    }
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
  })
}

async function waitForReconnect(input: {
  readonly dependencies: RemoteSessionHostRendererBridgeDependencies
  readonly delayMs: number
  readonly signal: AbortSignal
  readonly failureMessage: string
}) {
  try {
    await awaitWithSignal(input.dependencies.wait(input.delayMs, input.signal), input.signal)
    return true
  } catch (error) {
    if (input.signal.aborted) return false
    input.dependencies.logger.error(input.failureMessage, { error: errorMessage(error) })
    try {
      await waitWithTimer(input.delayMs, input.signal)
      return true
    } catch {
      return false
    }
  }
}

async function recoverRemoteRendererConnection(input: {
  readonly paths: LocalSessionHostPaths
  readonly clientVersion: string
  readonly dependencies: RemoteSessionHostRendererBridgeDependencies
  readonly signal: AbortSignal
  readonly error: unknown
  readonly attempt: number
}) {
  if (isTerminalRendererFailure(input.error)) {
    input.dependencies.logger.error(
      'Remote Session Host renderer subscription stopped after a terminal failure.',
      { error: errorMessage(input.error) },
    )
    return false
  }

  let ensureError: unknown
  try {
    await awaitWithSignal(
      input.dependencies.ensure({
        paths: input.paths,
        clientKind: 'gui',
        clientVersion: input.clientVersion,
        supportedRevisions: [LOCAL_SESSION_CURRENT_REVISION],
        signal: input.signal,
      }),
      input.signal,
    )
  } catch (error) {
    if (input.signal.aborted) return false
    if (isTerminalRendererFailure(error)) {
      input.dependencies.logger.error(
        'Remote Session Host renderer recovery stopped after a terminal failure.',
        { error: errorMessage(error) },
      )
      return false
    }
    ensureError = error
  }

  const delayMs = remoteRecoveryDelay(input.attempt)
  input.dependencies.logger.warn('Remote Session Host renderer connection is degraded; retrying.', {
    attempt: input.attempt,
    delayMs,
    error: errorMessage(ensureError ?? input.error),
  })
  return waitForReconnect({
    dependencies: input.dependencies,
    delayMs,
    signal: input.signal,
    failureMessage: 'Remote Session Host renderer recovery delay failed.',
  })
}

export async function runRemoteSessionHostRendererPump(input: {
  readonly paths: LocalSessionHostPaths
  readonly clientVersion: string
  readonly dependencies: RemoteSessionHostRendererBridgeDependencies
  readonly signal: AbortSignal
  readonly handlers: RemoteSessionHostRendererPumpHandlers
}) {
  let after: SessionHostEventEnvelope['cursor'] | undefined
  let pendingResyncReason: string | undefined
  let recoveryAttempts = 0
  const markConnected = () => {
    recoveryAttempts = 0
  }

  while (!input.signal.aborted) {
    try {
      const result = await awaitWithSignal(
        input.dependencies.watch({
          paths: input.paths,
          clientKind: 'gui',
          clientVersion: input.clientVersion,
          supportedRevisions: [LOCAL_SESSION_CURRENT_REVISION],
          workingDirectory: process.cwd(),
          ...(after ? { after } : {}),
          signal: input.signal,
          onSnapshot: (snapshots) => {
            markConnected()
            input.handlers.onSnapshot(snapshots)
            if (!pendingResyncReason) return
            const reason = pendingResyncReason
            pendingResyncReason = undefined
            input.handlers.onResyncRequired(reason)
          },
          onCursor: (cursor) => {
            markConnected()
            after = cursor
          },
          onEvent: (event) => {
            markConnected()
            after = event.cursor
            input.handlers.onEvent(event)
          },
        }),
        input.signal,
      )
      if (result.status === 'resync-required') {
        markConnected()
        after = undefined
        pendingResyncReason = result.reason
      }
      if (result.status === 'closed' && !input.signal.aborted) {
        throw new RemoteSessionHostSubscriptionClosedError()
      }
    } catch (error) {
      if (input.signal.aborted) break
      recoveryAttempts += 1
      const retry = await recoverRemoteRendererConnection({
        paths: input.paths,
        clientVersion: input.clientVersion,
        dependencies: input.dependencies,
        signal: input.signal,
        error,
        attempt: recoveryAttempts,
      })
      if (!retry) break
      continue
    }
    const retry = await waitForReconnect({
      dependencies: input.dependencies,
      delayMs: REMOTE_RECONNECT_DELAY_MS,
      signal: input.signal,
      failureMessage: 'Remote Session Host renderer reconnect delay failed.',
    })
    if (!retry) break
  }
}
