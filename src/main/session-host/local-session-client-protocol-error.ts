export class LocalSessionClientProtocolError extends Error {
  constructor(
    readonly code: string,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'LocalSessionClientProtocolError'
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
  return new LocalSessionClientProtocolError(code, message)
}
