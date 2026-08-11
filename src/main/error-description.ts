export function describeError(error: unknown) {
  return error instanceof Error
    ? { message: error.message, name: error.name, stack: error.stack }
    : { message: String(error) }
}
