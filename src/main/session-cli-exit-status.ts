import type { LocalSessionCommandResult } from '@shared/types/local-session-protocol'
import { type SessionsCliErrorKind, sessionsCliErrorKindForCode } from './sessions-cli-output'

export const SESSION_CLI_EXIT = {
  SUCCESS: 0,
  FAILURE: 1,
  USAGE: 2,
  AUTHENTICATION: 3,
  AUTHORIZATION: 4,
  NOT_FOUND: 5,
  CONFLICT: 6,
  TIMEOUT: 7,
  HOST_UNAVAILABLE: 8,
} as const

export function sessionCliExitCodeForError(kind: SessionsCliErrorKind) {
  const codes: Record<SessionsCliErrorKind, number> = {
    usage: SESSION_CLI_EXIT.USAGE,
    authentication: SESSION_CLI_EXIT.AUTHENTICATION,
    authorization: SESSION_CLI_EXIT.AUTHORIZATION,
    not_found: SESSION_CLI_EXIT.NOT_FOUND,
    conflict: SESSION_CLI_EXIT.CONFLICT,
    timeout: SESSION_CLI_EXIT.TIMEOUT,
    host_unavailable: SESSION_CLI_EXIT.HOST_UNAVAILABLE,
    internal: SESSION_CLI_EXIT.FAILURE,
  }
  return codes[kind]
}

function errorKindForOutcomeCode(code: string): SessionsCliErrorKind {
  return sessionsCliErrorKindForCode(code) ?? 'conflict'
}

export function sessionCliResultErrorKind(
  result: LocalSessionCommandResult,
): SessionsCliErrorKind | undefined {
  if (result.contract === 'session-query-v2') {
    return 'error' in result.response.outcome
      ? errorKindForOutcomeCode(result.response.outcome.error.code)
      : undefined
  }
  if (
    (result.contract === 'session-control-v2' || result.contract === 'session-lifecycle-v2') &&
    result.response.outcome.effect === 'rejected'
  ) {
    return errorKindForOutcomeCode(result.response.outcome.code)
  }
  return undefined
}
