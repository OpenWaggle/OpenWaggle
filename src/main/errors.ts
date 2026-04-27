import { Data } from 'effect'

export class ValidationIssuesError extends Data.TaggedError('ValidationIssuesError')<{
  readonly operation: string
  readonly issues: readonly string[]
}> {}

export class DatabaseBootstrapError extends Data.TaggedError('DatabaseBootstrapError')<{
  readonly stage: string
  readonly message: string
  readonly cause?: unknown
}> {}

export class DatabaseQueryError extends Data.TaggedError('DatabaseQueryError')<{
  readonly operation: string
  readonly cause?: unknown
}> {}

export class ProviderLookupError extends Data.TaggedError('ProviderLookupError')<{
  readonly modelId: string
}> {}

export class SessionProjectionRepositoryError extends Data.TaggedError(
  'SessionProjectionRepositoryError',
)<{
  readonly operation: string
  readonly cause?: unknown
}> {}

export class StandardsLoadError extends Data.TaggedError('StandardsLoadError')<{
  readonly message: string
  readonly cause?: unknown
}> {}
