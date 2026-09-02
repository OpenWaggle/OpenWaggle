export class SyntaxSourceValidationError extends Error {
  override readonly name = 'SyntaxSourceValidationError'
}

function isCodedOperationalError(error: unknown) {
  return error instanceof Error && 'code' in error && typeof error.code === 'string'
}

export async function classifySyntaxSourceValidation<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation()
  } catch (error) {
    if (error instanceof SyntaxSourceValidationError || isCodedOperationalError(error)) throw error
    throw new SyntaxSourceValidationError(
      error instanceof Error ? error.message : 'Syntax resource validation failed.',
      { cause: error },
    )
  }
}
