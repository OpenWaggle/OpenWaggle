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

export class SessionControlRepositoryError extends Data.TaggedError(
  'SessionControlRepositoryError',
)<{
  readonly operation: string
  readonly cause?: unknown
}> {}

export class SessionControlOperationPendingError extends Data.TaggedError(
  'SessionControlOperationPendingError',
)<{
  readonly operation: string
  readonly sessionId: string
  readonly idempotencyKey: string
}> {}

export class SessionLifecycleRepositoryError extends Data.TaggedError(
  'SessionLifecycleRepositoryError',
)<{
  readonly operation: string
  readonly cause?: unknown
}> {}

export class SessionLifecyclePreparationError extends Data.TaggedError(
  'SessionLifecyclePreparationError',
)<{
  readonly operation: string
  readonly cause?: unknown
}> {}

export class LocalSessionProfileRepositoryError extends Data.TaggedError(
  'LocalSessionProfileRepositoryError',
)<{
  readonly operation: string
  readonly cause?: unknown
}> {}

export class LocalSessionAuthenticationError extends Data.TaggedError(
  'LocalSessionAuthenticationError',
)<{
  readonly code: 'profile_not_found' | 'profile_revoked' | 'credential_rejected'
}> {}

export class LocalSessionCommandAuthorizationError extends Data.TaggedError(
  'LocalSessionCommandAuthorizationError',
)<{
  readonly code:
    | 'capability_denied'
    | 'target_scope_denied'
    | 'authorization_ceiling_exceeded'
    | 'profile_not_found'
    | 'profile_revoked'
  readonly missing?: readonly string[]
}> {}

export class SessionAuthorizationTargetRepositoryError extends Data.TaggedError(
  'SessionAuthorizationTargetRepositoryError',
)<{
  readonly operation: string
  readonly cause?: unknown
}> {}

export class SessionHostRecoveryRepositoryError extends Data.TaggedError(
  'SessionHostRecoveryRepositoryError',
)<{
  readonly operation: string
  readonly cause?: unknown
}> {}

export class SessionQueryRepositoryError extends Data.TaggedError('SessionQueryRepositoryError')<{
  readonly operation: string
  readonly cause?: unknown
}> {}

export class SessionExportOperationRepositoryError extends Data.TaggedError(
  'SessionExportOperationRepositoryError',
)<{
  readonly operation: string
  readonly cause?: unknown
}> {}

export class SessionExportArtifactError extends Data.TaggedError('SessionExportArtifactError')<{
  readonly operation: string
  readonly message: string
  readonly cause?: unknown
}> {}

export class StandardsLoadError extends Data.TaggedError('StandardsLoadError')<{
  readonly message: string
  readonly cause?: unknown
}> {}

export class ExtensionDiscoveryError extends Data.TaggedError('ExtensionDiscoveryError')<{
  readonly operation: string
  readonly cause?: unknown
}> {}

export class ExtensionLifecycleRepositoryError extends Data.TaggedError(
  'ExtensionLifecycleRepositoryError',
)<{
  readonly operation: string
  readonly cause?: unknown
}> {}

export class ExtensionProjectOverrideRepositoryError extends Data.TaggedError(
  'ExtensionProjectOverrideRepositoryError',
)<{
  readonly operation: string
  readonly cause?: unknown
}> {}

export class ExtensionStorageRepositoryError extends Data.TaggedError(
  'ExtensionStorageRepositoryError',
)<{
  readonly operation: string
  readonly cause?: unknown
}> {}

export class ExtensionBuildRunnerError extends Data.TaggedError('ExtensionBuildRunnerError')<{
  readonly operation: string
  readonly cause?: unknown
}> {}

export class ExtensionPackageRepositoryError extends Data.TaggedError(
  'ExtensionPackageRepositoryError',
)<{
  readonly operation: string
  readonly cause?: unknown
}> {}

export class DocsBundleError extends Data.TaggedError('DocsBundleError')<{
  readonly operation: string
  readonly cause?: unknown
}> {}

export class WorkspaceFileError extends Data.TaggedError('WorkspaceFileError')<{
  readonly operation: string
  readonly message: string
  readonly cause?: unknown
}> {}
