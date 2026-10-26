interface LocalSessionClientProtocolErrorOptions extends ErrorOptions {
  readonly retryable?: boolean
}

export class LocalSessionClientProtocolError extends Error {
  readonly retryable: boolean | undefined

  constructor(
    readonly code: string,
    message: string,
    options?: LocalSessionClientProtocolErrorOptions,
  ) {
    super(message, options)
    this.name = 'LocalSessionClientProtocolError'
    this.retryable = options?.retryable
  }
}

export function localSessionClientProtocolError(
  value: unknown,
  fallbackMessage: string,
): LocalSessionClientProtocolError {
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
  return new LocalSessionClientProtocolError(
    code,
    message,
    retryable === undefined ? undefined : { retryable },
  )
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

  constructor(
    readonly hostInstanceId: string,
    readonly blockingRuns: readonly { readonly sessionId: string; readonly runId: string }[],
    readonly blockingOperations: readonly {
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
    this.name = 'LocalSessionHostUpgradePendingError'
  }
}
