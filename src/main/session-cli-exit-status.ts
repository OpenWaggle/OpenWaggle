import type { LocalSessionCommandResult } from '@shared/types/local-session-protocol'
import { CLI_EXIT, cliExitCodeForKind } from './cli-error'
import { type SessionsCliErrorKind, sessionsCliErrorKindForCode } from './sessions-cli-output'

export const SESSION_CLI_EXIT = CLI_EXIT

export function sessionCliExitCodeForError(kind: SessionsCliErrorKind) {
  return cliExitCodeForKind(kind)
}

function errorKindForOutcomeCode(code: string): SessionsCliErrorKind {
  return sessionsCliErrorKindForCode(code) ?? 'conflict'
}

export function sessionCliResultErrorKind(
  result: LocalSessionCommandResult,
): SessionsCliErrorKind | undefined {
  if (result.contract === 'session-query-v2') {
    const outcome = result.response.outcome
    if ('error' in outcome) return errorKindForOutcomeCode(outcome.error.code)
    // A bounded wait that ended without its condition still answers on stdout, with the timeout
    // exit class, so a script can tell "reached" from "gave up" (#351).
    return 'timedOut' in outcome && outcome.timedOut === true ? 'timeout' : undefined
  }
  if (result.contract === 'scheduled-tasks-v1') {
    const outcome = result.response.outcome
    if (outcome.effect !== 'rejected') return undefined
    if (outcome.code === 'task_not_found' || outcome.code === 'target_not_found') return 'not_found'
    if (outcome.code === 'capability_denied' || outcome.code === 'target_scope_denied') {
      return 'authorization'
    }
    return outcome.code.startsWith('invalid_') ? 'usage' : 'conflict'
  }
  if (
    (result.contract === 'session-control-v2' || result.contract === 'session-lifecycle-v2') &&
    result.response.outcome.effect === 'rejected'
  ) {
    return errorKindForOutcomeCode(result.response.outcome.code)
  }
  return undefined
}
