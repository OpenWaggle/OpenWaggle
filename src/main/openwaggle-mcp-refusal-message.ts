import {
  isSessionHostErrorKind,
  type SessionHostErrorKind,
  type SessionHostRefusalCode,
  sessionHostErrorKindForThrownCode,
  sessionHostRefusal,
} from '@shared/domain/session-host-refusals'
import type { executeLocalSessionCommand } from './session-host/local-session-client'
import { LocalSessionClientProtocolError } from './session-host/local-session-client-protocol-error'

/**
 * Every refusal the `openwaggle_hive` MCP tool reports starts with its code and the kind the
 * Session Host's refusal table gives it (ADR 0063): `session_not_found (not_found): …`.
 */
export function mcpRefusalMessage(code: string, kind: SessionHostErrorKind, message: string) {
  return `${code} (${kind}): ${message}`
}

/** A refusal the MCP server makes itself, before the Session Host sees the request. */
export function mcpLocalRefusal(code: SessionHostRefusalCode, message: string) {
  const refusal = sessionHostRefusal(code)
  return new Error(mcpRefusalMessage(refusal.code, refusal.kind, message))
}

/** A query error the MCP server meets on its own reads, such as a scope check's `read`. */
export function mcpQueryErrorRefusal(error: object) {
  const code = 'code' in error ? error.code : undefined
  const message = 'message' in error ? error.message : undefined
  const declared = 'kind' in error ? error.kind : undefined
  const refusalCode = typeof code === 'string' ? code : 'query_failed'
  return new Error(
    mcpRefusalMessage(
      refusalCode,
      isSessionHostErrorKind(declared) ? declared : sessionHostErrorKindForThrownCode(refusalCode),
      typeof message === 'string' ? message : 'Query failed.',
    ),
  )
}

/** A refusal the Session Host threw, worded like the outcomes it rejects. */
export function mcpThrownRefusal(error: unknown): unknown {
  if (!(error instanceof LocalSessionClientProtocolError)) return error
  const kind = error.errorKind ?? sessionHostErrorKindForThrownCode(error.code)
  return new Error(mcpRefusalMessage(error.code, kind, error.message), { cause: error })
}

/**
 * A Session Host refusal fails the MCP call. Its message starts with the code and the kind the
 * Host gave it (ADR 0063), `session_not_found (not_found): …`, as the CLI's exit code does.
 */
export function assertSuccessfulMcpSessionResult(
  value: Awaited<ReturnType<typeof executeLocalSessionCommand>>,
) {
  if (value.contract === 'session-query-v2' && 'error' in value.response.outcome) {
    const { code, kind, message } = value.response.outcome.error
    throw new Error(mcpRefusalMessage(code, kind, message))
  }
  if (
    (value.contract === 'session-control-v2' || value.contract === 'session-lifecycle-v2') &&
    value.response.outcome.effect === 'rejected'
  ) {
    const { code, kind, operation } = value.response.outcome
    throw new Error(mcpRefusalMessage(code, kind, `${operation} was rejected.`))
  }
  return value
}
