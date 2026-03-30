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

export class AgentCancelledError extends Data.TaggedError('AgentCancelledError')<
  Record<string, never>
> {}

// ─── Port-layer errors (hexagonal architecture) ──────────────

export class ChatStreamError extends Data.TaggedError('ChatStreamError')<{
  readonly message: string
  readonly cause?: unknown
}> {}

export class ToolExecutionError extends Data.TaggedError('ToolExecutionError')<{
  readonly message: string
  readonly cause?: unknown
}> {}

export class ConversationRepositoryError extends Data.TaggedError('ConversationRepositoryError')<{
  readonly operation: string
  readonly cause?: unknown
}> {}

export class StandardsLoadError extends Data.TaggedError('StandardsLoadError')<{
  readonly message: string
  readonly cause?: unknown
}> {}
