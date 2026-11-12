import {
  isSessionHostErrorKind,
  type SessionHostErrorKind,
} from '@shared/domain/session-host-refusals'

interface LocalSessionClientProtocolErrorOptions extends ErrorOptions {
  readonly retryable?: boolean
  /** The kind the Session Host gave the failure (ADR 0063); absent from a client-side failure. */
  readonly errorKind?: SessionHostErrorKind
}

export class LocalSessionClientProtocolError extends Error {
  readonly retryable: boolean | undefined
  readonly errorKind: SessionHostErrorKind | undefined

  readonly code: string

  constructor(code: string, message: string, options?: LocalSessionClientProtocolErrorOptions) {
    super(message, options)
    this.code = code
    this.name = 'LocalSessionClientProtocolError'
    this.retryable = options?.retryable
    this.errorKind = options?.errorKind
  }
}

export function localSessionClientProtocolError(value: unknown, fallbackMessage: string) {
  if (typeof value !== 'object' || value === null) {
    return new LocalSessionClientProtocolError('protocol_error', fallbackMessage)
  }
  const code = 'code' in value && typeof value.code === 'string' ? value.code : 'protocol_error'
  const message =
    'message' in value && typeof value.message === 'string' && value.message.length > 0
      ? value.message
      : fallbackMessage
  const retryable =
    'retryable' in value && typeof value.retryable === 'boolean' ? value.retryable : undefined
  const errorKind =
    'errorKind' in value && isSessionHostErrorKind(value.errorKind) ? value.errorKind : undefined
  return new LocalSessionClientProtocolError(code, message, {
    ...(retryable === undefined ? {} : { retryable }),
    ...(errorKind === undefined ? {} : { errorKind }),
  })
}

/** The Session Host cannot be reached, started, or spoken to by this client. */
export class LocalSessionHostUnavailableError extends Error {
  override readonly name = 'LocalSessionHostUnavailableError'
}

/** The Session Host did not answer within the client's wait. */
export class LocalSessionClientTimeoutError extends Error {
  override readonly name = 'LocalSessionClientTimeoutError'
}

/** An older Session Host is handing over to this version and is not serving requests yet. */
export class LocalSessionHostUpgradePendingError extends Error {
  readonly code = 'host_upgrade_pending'

  readonly hostInstanceId: string
  readonly blockingRuns: readonly { readonly sessionId: string; readonly runId: string }[]
  readonly blockingOperations: readonly {
    readonly operationId: string
    readonly operation: string
    readonly targetScope: string
  }[]

  constructor(
    hostInstanceId: string,
    blockingRuns: readonly { readonly sessionId: string; readonly runId: string }[],
    blockingOperations: readonly {
      readonly operationId: string
      readonly operation: string
      readonly targetScope: string
    }[],
  ) {
    const blockerCount = blockingRuns.length + blockingOperations.length
    super(
      blockerCount === 0
        ? 'The existing Local Session Host is releasing ownership for a safe version handoff.'
        : `The existing Local Session Host is draining ${blockerCount} active ${blockerCount === 1 ? 'operation' : 'operations'} before a safe version handoff.`,
    )
    this.hostInstanceId = hostInstanceId
    this.blockingRuns = blockingRuns
    this.blockingOperations = blockingOperations
    this.name = 'LocalSessionHostUpgradePendingError'
  }
}
