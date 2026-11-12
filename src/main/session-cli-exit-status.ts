import { isSessionHostErrorKind } from '@shared/domain/session-host-refusals'
import type { LocalSessionCommandResult } from '@shared/types/local-session-protocol'
import { CLI_EXIT, CliError, cliExitCodeForKind } from './cli-error'
import type { SessionsCliErrorKind } from './sessions-cli-output'

export const SESSION_CLI_EXIT = CLI_EXIT

export function sessionCliExitCodeForError(kind: SessionsCliErrorKind) {
  return cliExitCodeForKind(kind)
}

/**
 * The kind the Session Host gave a refusal (ADR 0063). The CLI never reads it from the code. A
 * refusal that somehow arrives without a kind is a `conflict`, the state refusing the request.
 */
function refusalKind(refusal: { readonly kind?: unknown }): SessionsCliErrorKind {
  return isSessionHostErrorKind(refusal.kind) ? refusal.kind : 'conflict'
}

export function sessionCliResultErrorKind(
  result: LocalSessionCommandResult,
): SessionsCliErrorKind | undefined {
  if (result.contract === 'session-query-v2') {
    const outcome = result.response.outcome
    if ('error' in outcome) return refusalKind(outcome.error)
    // A bounded wait that ended without its condition still answers on stdout, with the timeout
    // exit class, so a script can tell "reached" from "gave up" (#351).
    return 'timedOut' in outcome && outcome.timedOut ? 'timeout' : undefined
  }
  if (
    (result.contract === 'scheduled-tasks-v1' ||
      result.contract === 'session-control-v2' ||
      result.contract === 'session-lifecycle-v2' ||
      result.contract === 'local-access-v1') &&
    result.response.outcome.effect === 'rejected'
  ) {
    return refusalKind(result.response.outcome)
  }
  return undefined
}

/**
 * A later page of `hive export` or `hive read --full` that the Session Host refused: the command
 * stops with the refusal's kind, as a refused first page does (ADR 0063).
 */
export function pageQueryRefusal(error: Readonly<Record<string, unknown>>) {
  const code = typeof error['code'] === 'string' ? error['code'] : 'query_failed'
  const message = typeof error['message'] === 'string' ? error['message'] : 'Query failed.'
  return new CliError(refusalKind(error), `${code}: ${message}`, { code })
}
