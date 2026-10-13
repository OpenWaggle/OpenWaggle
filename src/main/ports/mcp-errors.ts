import { Data } from 'effect'

/**
 * Tagged failures for the MCP secret vault port.
 *
 * Every error extends {@link Error} (via Effect's `Data.TaggedError`) so the IPC boundary can
 * still surface `.message`, while callers can branch on the `_tag`/`reason` discriminants.
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
