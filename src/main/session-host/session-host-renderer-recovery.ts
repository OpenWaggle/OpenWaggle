import type { BackgroundRunSnapshot } from '@shared/types/background-run'
import { LOCAL_SESSION_CURRENT_REVISION } from '@shared/types/local-session-protocol'
import type { Logger } from '@shared/types/logger'
import type { SessionHostEventEnvelope } from '@shared/types/session-host-event'
import type { watchLocalSessionEvents } from './local-session-client'
import { LocalSessionClientProtocolError } from './local-session-client-protocol-error'
import type { ensureLocalSessionHost } from './local-session-host-launcher'
import type { LocalSessionHostPaths, refreshLocalSessionHostEndpoint } from './local-session-paths'

const REMOTE_RECONNECT_DELAY_MS = 250
const REMOTE_RECOVERY_MAX_DELAY_MS = 4_000
const REMOTE_RECOVERY_BACKOFF_FACTOR = 2
const REMOTE_RECOVERY_MAX_BACKOFF_EXPONENT = Math.ceil(
  Math.log(REMOTE_RECOVERY_MAX_DELAY_MS / REMOTE_RECONNECT_DELAY_MS) /
    Math.log(REMOTE_RECOVERY_BACKOFF_FACTOR),
)
/** Retry interval once recovery keeps failing, and after authentication failures. */
const REMOTE_RECOVERY_LONG_DELAY_MS = 30_000
/** Consecutive failed recoveries after which the pump logs one error and retries slowly. */
const REMOTE_RECOVERY_ESCALATION_ATTEMPTS = 10
/** How long a subscription must stay up before its failure no longer counts as consecutive. */
const REMOTE_HEALTHY_SUBSCRIPTION_MS = 10_000
/**
 * The Host throttles authentication for 30 s after a burst of failed attempts from any local
 * client. A Host-wide throttle says so; older Hosts report it as an ordinary
 * `authentication_failed`, so that code waits out the throttle once a quick retry has failed too.
 */
const QUICK_AUTHENTICATION_RETRIES = 1

function needsSlowRetry(error: unknown, attempt: number) {
  if (!(error instanceof LocalSessionClientProtocolError)) return false
  if (error.code === 'authentication_throttled') return true
  return error.code === 'authentication_failed' && attempt > QUICK_AUTHENTICATION_RETRIES
}

class RemoteSessionHostSubscriptionClosedError extends Error {
  constructor() {
    super('Remote Session Host closed the renderer subscription.')
    this.name = 'RemoteSessionHostSubscriptionClosedError'
  }
}

export interface RemoteSessionHostRendererBridgeDependencies {
  readonly watch: typeof watchLocalSessionEvents
  readonly ensure: (input: Parameters<typeof ensureLocalSessionHost>[0]) => Promise<unknown>
  readonly refreshPaths: typeof refreshLocalSessionHostEndpoint
  readonly wait: (milliseconds: number, signal?: AbortSignal) => Promise<void>
  readonly logger: Pick<Logger, 'warn' | 'error'>
  readonly now?: () => number
}

interface RemoteSessionHostRendererPumpHandlers {
  readonly onSnapshot: (snapshots: readonly BackgroundRunSnapshot[]) => void
  readonly onResyncRequired: (reason: string) => void
  readonly onEvent: (event: SessionHostEventEnvelope) => void
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

/** Attempts that are not a power of two are counted into the next logged one. */
function isLoggedRecoveryAttempt(attempt: number) {
  return attempt > 0 && Number.isInteger(Math.log2(attempt))
}

/** Logs attempts 1, 2, 4, 8, ... and escalates once; returns whether this attempt logged. */
function logRecoveryAttempt(
  logger: RemoteSessionHostRendererBridgeDependencies['logger'],
  attempt: number,
  details: object,
) {
  if (attempt === REMOTE_RECOVERY_ESCALATION_ATTEMPTS) {
    logger.error('Remote Session Host renderer connection keeps failing; retrying slowly.', details)
    return true
  }
  if (!isLoggedRecoveryAttempt(attempt)) return false
  logger.warn('Remote Session Host renderer connection is degraded; retrying.', details)
  return true
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

function remoteRecoveryDelay(attempt: number, error: unknown) {
  if (attempt >= REMOTE_RECOVERY_ESCALATION_ATTEMPTS || needsSlowRetry(error, attempt)) {
    return REMOTE_RECOVERY_LONG_DELAY_MS
  }
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
  readonly suppressedWarnings: number
}) {
  // No failure stops the pump. The renderer has no other source of live Session events, so
  // stopping froze every Session until OpenWaggle restarted. Hosts mark connection-level failures
  // such as a handshake timeout under load non-retryable, an older Host that outlived a GUI update
  // still does, and nothing the launcher reports is permanent for the GUI's own connection.
  // Persistent failures retry slowly instead.
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
    if (input.signal.aborted) return { retry: false, logged: false }
    ensureError = error
  }

  const failure = ensureError ?? input.error
  const delayMs = remoteRecoveryDelay(input.attempt, failure)
  const details = {
    attempt: input.attempt,
    delayMs,
    error: errorMessage(failure),
    ...(input.suppressedWarnings > 0 ? { suppressedWarnings: input.suppressedWarnings } : {}),
  }
  const logged = logRecoveryAttempt(input.dependencies.logger, input.attempt, details)
  const retry = await waitForReconnect({
    dependencies: input.dependencies,
    delayMs,
    signal: input.signal,
    failureMessage: 'Remote Session Host renderer recovery delay failed.',
  })
  return { retry, logged }
}

export async function runRemoteSessionHostRendererPump(input: {
  readonly paths: LocalSessionHostPaths
  readonly clientVersion: string
  readonly dependencies: RemoteSessionHostRendererBridgeDependencies
  readonly signal: AbortSignal
  readonly handlers: RemoteSessionHostRendererPumpHandlers
}) {
  let paths = input.paths
  let after: SessionHostEventEnvelope['cursor'] | undefined
  let pendingResyncReason: string | undefined
  const now = input.dependencies.now ?? (() => performance.now())
  let recoveryAttempts = 0
  let suppressedWarnings = 0
  // A snapshot alone does not prove recovery: a Host that fails every subscription right after
  // its snapshot would otherwise retry at the shortest delay forever. Recovery counts once the
  // stream delivers something after it was established, or stays up long enough.
  const markHealthy = () => {
    recoveryAttempts = 0
    suppressedWarnings = 0
  }

  while (!input.signal.aborted) {
    let establishedAt: number | undefined
    let initialCursorSeen = false
    const markEstablished = () => {
      establishedAt ??= now()
    }
    const markHealthyIfLongLived = () => {
      if (establishedAt !== undefined && now() - establishedAt >= REMOTE_HEALTHY_SUBSCRIPTION_MS) {
        markHealthy()
      }
    }
    try {
      paths = await awaitWithSignal(input.dependencies.refreshPaths(paths), input.signal)
      const result = await awaitWithSignal(
        input.dependencies.watch({
          paths,
          clientKind: 'gui',
          clientVersion: input.clientVersion,
          supportedRevisions: [LOCAL_SESSION_CURRENT_REVISION],
          workingDirectory: process.cwd(),
          ...(after ? { after } : {}),
          signal: input.signal,
          onSnapshot: (snapshots) => {
            markEstablished()
            input.handlers.onSnapshot(snapshots)
            if (!pendingResyncReason) return
            const reason = pendingResyncReason
            pendingResyncReason = undefined
            input.handlers.onResyncRequired(reason)
          },
          onCursor: (cursor) => {
            // The first cursor confirms the subscription; later ones are stream progress.
            if (initialCursorSeen) markHealthy()
            initialCursorSeen = true
            markEstablished()
            after = cursor
          },
          onEvent: (event) => {
            markEstablished()
            markHealthy()
            after = event.cursor
            input.handlers.onEvent(event)
          },
        }),
        input.signal,
      )
      markHealthyIfLongLived()
      if (result.status === 'resync-required') {
        after = undefined
        pendingResyncReason = result.reason
      }
      if (result.status === 'closed' && !input.signal.aborted) {
        throw new RemoteSessionHostSubscriptionClosedError()
      }
    } catch (error) {
      if (input.signal.aborted) break
      markHealthyIfLongLived()
      recoveryAttempts += 1
      const recovery = await recoverRemoteRendererConnection({
        paths,
        clientVersion: input.clientVersion,
        dependencies: input.dependencies,
        signal: input.signal,
        error,
        attempt: recoveryAttempts,
        suppressedWarnings,
      })
      suppressedWarnings = recovery.logged ? 0 : suppressedWarnings + 1
      if (!recovery.retry) break
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
