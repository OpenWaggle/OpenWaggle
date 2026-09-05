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
