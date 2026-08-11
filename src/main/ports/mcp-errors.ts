import { Data } from 'effect'

/**
 * Tagged failure taxonomy for the MCP ports.
 *
 * These replace the generic `Error` failure channels that the first-party MCP
 * ports previously exposed. Every error extends {@link Error} (via Effect's
 * `Data.TaggedError`) so the IPC boundary can still surface `.message`, while
 * application/runtime code can branch on the `_tag`/`reason` discriminants.
 *
 * The exported `*Failure` aliases are the types the ports depend on. Keeping the
 * ports pinned to the alias lets later slices widen a failure into a union
 * without editing every port signature again.
 */

// --- Secret vault ---------------------------------------------------------

/** Discriminates why an MCP secret-vault operation failed. */
export type McpVaultErrorReason =
  | 'encryption-unavailable'
  | 'secret-not-found'
  | 'decryption-failed'
  | 'validation'
  | 'io'

/** A failure raised by the encrypted MCP secret vault adapter. */
export class McpVaultError extends Data.TaggedError('McpVaultError')<{
  readonly reason: McpVaultErrorReason
  readonly message: string
  readonly secretName?: string
  readonly cause?: unknown
}> {}

/** Failure channel exposed by {@link McpSecretVaultService}. */
export type McpVaultFailure = McpVaultError

// --- Runtime --------------------------------------------------------------

/**
 * A generic failure raised by the first-party MCP runtime service. Used as a
 * catch-all wrapper around unexpected thrown values at SDK/transport edges.
 */
export class McpRuntimeError extends Data.TaggedError('McpRuntimeError')<{
  readonly operation: string
  readonly message: string
  readonly cause?: unknown
}> {}

/** The requested MCP server is not enabled in the current turn snapshot. */
export class McpServerNotEnabled extends Data.TaggedError('McpServerNotEnabled')<{
  readonly serverInstanceId?: string
  readonly message: string
}> {}

/** A tool handle is unknown or belongs to a superseded snapshot revision. */
export class McpStaleToolHandle extends Data.TaggedError('McpStaleToolHandle')<{
  readonly message: string
}> {}

/** A required MCP server could not connect or load, so the turn cannot proceed. */
export class McpRequiredServerUnavailable extends Data.TaggedError('McpRequiredServerUnavailable')<{
  readonly serverInstanceId: string
  readonly serverLabel: string
  readonly detail: string
  readonly message: string
}> {}

/** Failure channel exposed by {@link McpRuntimeService}. */
export type McpRuntimeFailure =
  | McpRuntimeError
  | McpServerNotEnabled
  | McpStaleToolHandle
  | McpRequiredServerUnavailable

/** Wrap an unknown thrown value as a tagged runtime failure, preserving its message. */
export function toMcpRuntimeError(operation: string, error: unknown): McpRuntimeError {
  return new McpRuntimeError({
    operation,
    message: error instanceof Error ? error.message : String(error),
    cause: error,
  })
}

/** Wrap an unknown thrown value as a tagged vault failure, preserving its message. */
export function toMcpVaultError(
  reason: McpVaultErrorReason,
  error: unknown,
  secretName?: string,
): McpVaultError {
  return new McpVaultError({
    reason,
    message: error instanceof Error ? error.message : String(error),
    ...(secretName === undefined ? {} : { secretName }),
    cause: error,
  })
}
