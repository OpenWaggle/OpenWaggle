export function describeError(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

export function hasNodeErrorCode(error: unknown, code: string) {
  return (
    error instanceof Error &&
    'code' in error &&
    typeof error.code === 'string' &&
    error.code === code
  )
}
