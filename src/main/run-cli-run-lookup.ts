import type {
  LocalSessionCommandPayload,
  LocalSessionCommandResult,
} from '@shared/types/local-session-protocol'
import {
  isActiveRunStatus,
  type RunSettlement,
  type RunTarget,
  recentRunsQuery,
  settlementForRunStatus,
} from './run-cli-settlement'
import {
  SESSION_CLI_EXIT,
  sessionCliExitCodeForError,
  sessionCliResultErrorKind,
} from './session-cli-exit-status'
import { classifySessionsCliError, type SessionsCliErrorKind } from './sessions-cli-output'

/** Pages of recent Runs searched; a replayed launch may name a Run well behind the newest. */
const RUN_LOOKUP_PAGE_LIMIT = 10
/** Errors that may clear up on their own, so the stream keeps being watched. */
const TRANSIENT_ERROR_KINDS: ReadonlySet<SessionsCliErrorKind> = new Set([
  'host_unavailable',
  'timeout',
])

export type RunLookup =
  | { readonly kind: 'active' }
  | { readonly kind: 'settled'; readonly settlement: RunSettlement }
  | { readonly kind: 'unknown'; readonly reason: string }

type Execute = (payload: LocalSessionCommandPayload) => Promise<LocalSessionCommandResult>

/**
 * Look the Run up among the Session's durable Runs. A missing Run, or an error that will not
 * clear up by waiting, settles the command instead of leaving it waiting forever.
 */
export async function lookUpRun(execute: Execute, target: RunTarget): Promise<RunLookup> {
  let cursor: string | undefined
  for (let page = 0; page < RUN_LOOKUP_PAGE_LIMIT; page += 1) {
    const read = await execute(recentRunsQuery(target, cursor)).then(
      (result) => ({ result, errorKind: sessionCliResultErrorKind(result) }),
      (error: unknown) => ({ result: undefined, errorKind: classifySessionsCliError(error) }),
    )
    if (read.errorKind) return lookupForError(read.errorKind, target)
    const result = read.result
    if (!result) return { kind: 'unknown', reason: 'no response' }
    const outcome = result.contract === 'session-query-v2' ? result.response.outcome : undefined
    if (outcome?.operation !== 'turns' || !('turns' in outcome)) {
      return { kind: 'unknown', reason: 'unexpected response' }
    }
    const run = outcome.turns.find((turn) => turn.runId === target.runId)
    if (run) return lookupForStatus(run.status, target)
    if (!outcome.nextCursor) break
    cursor = outcome.nextCursor
  }
  return {
    kind: 'settled',
    settlement: {
      exitCode: SESSION_CLI_EXIT.FAILURE,
      message: `the Run is no longer listed for Session ${target.sessionId}.`,
    },
  }
}

function lookupForError(errorKind: SessionsCliErrorKind, target: RunTarget): RunLookup {
  if (TRANSIENT_ERROR_KINDS.has(errorKind)) return { kind: 'unknown', reason: errorKind }
  return {
    kind: 'settled',
    settlement: {
      exitCode: sessionCliExitCodeForError(errorKind),
      message: `could not read the Run's status (${errorKind}); check it with openwaggle sessions read ${target.sessionId}.`,
    },
  }
}

function lookupForStatus(status: string, target: RunTarget): RunLookup {
  if (isActiveRunStatus(status)) return { kind: 'active' }
  return { kind: 'settled', settlement: settlementForRunStatus(status, target) }
}
