export function isRunCancellation(error: unknown, signal: AbortSignal): boolean {
  if (signal.aborted) return true
  if (!(error instanceof Error)) return false
  return error.name === 'AbortError' || error.message === 'aborted'
}
