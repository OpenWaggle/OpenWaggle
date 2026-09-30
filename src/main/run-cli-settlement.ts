import { randomUUID } from 'node:crypto'
import type { LocalSessionCommandPayload } from '@shared/types/local-session-protocol'
import type { SessionHostEventPayload } from '@shared/types/session-host-event'
import { SESSION_QUERY_CONTRACT_VERSION } from '@shared/types/session-query'
import type { AgentTransportEvent } from '@shared/types/stream'
import { SESSION_CLI_EXIT } from './session-cli-exit-status'
import type { LocalSessionWatchResult } from './session-host/local-session-event-client'

/** Conventional shell status for a command stopped by SIGINT. */
export const RUN_CLI_INTERRUPTED_EXIT = 130
/** Runs read per page when reconciling; the launched Run is usually among the newest. */
export const RUN_RECONCILE_TURN_LIMIT = 20

export interface RunTarget {
  readonly sessionId: string
  readonly runId: string
}

export interface RunSettlement {
  readonly exitCode: number
  readonly message?: string
}

const ACTIVE_RUN_STATUSES = new Set(['starting', 'active', 'stopping'])

function readCommand(target: RunTarget) {
  return `openwaggle sessions read ${target.sessionId}`
}

/** Map a Run's durable or terminal status to the command's result. */
export function settlementForRunStatus(
  status: string | undefined,
  target: RunTarget,
  failureCode?: string,
): RunSettlement {
  const failure = failureCode ? ` (${failureCode})` : ''
  if (status === undefined || status === 'completed') return { exitCode: SESSION_CLI_EXIT.SUCCESS }
  if (status === 'failed') {
    return {
      exitCode: SESSION_CLI_EXIT.FAILURE,
      message: `Run failed${failure}. See the Session in the desktop app or run '${readCommand(target)}'.`,
    }
  }
  if (status === 'interrupted-by-interaction-timeout') {
    return {
      exitCode: SESSION_CLI_EXIT.TIMEOUT,
      message: 'Run stopped: a question was not answered before --interaction-timeout-ms.',
    }
  }
  if (status === 'interrupted-by-host-loss') {
    return {
      exitCode: SESSION_CLI_EXIT.HOST_UNAVAILABLE,
      message: 'Run stopped because the Session Host exited.',
    }
  }
  return { exitCode: RUN_CLI_INTERRUPTED_EXIT, message: `Run ${status}${failure}.` }
}

export function isActiveRunStatus(status: string) {
  return ACTIVE_RUN_STATUSES.has(status)
}

/**
 * The settlement a state change reports for this Run. `undefined` means the change says
 * nothing final; `reconcile` means the Session changed in a way that may have ended the Run
 * without a settlement event (it was replaced, or the Session was removed), so its durable
 * status must be read.
 */
export function classifyStateChange(
  payload: SessionHostEventPayload,
  target: RunTarget,
): RunSettlement | 'reconcile' | undefined {
  if (payload.kind === 'session-list-changed' && payload.change === 'deleted') {
    return {
      exitCode: SESSION_CLI_EXIT.NOT_FOUND,
      message: 'the Session was deleted before its Run finished.',
    }
  }
  if (payload.kind !== 'session-state-changed') return undefined
  const settles =
    payload.runId === target.runId &&
    (payload.operation === 'run-settled' || payload.operation === 'follow-up-started')
  if (!settles) return 'reconcile'
  if (payload.terminalStatus === undefined) return 'reconcile'
  return settlementForRunStatus(payload.terminalStatus, target, payload.failureCode)
}

/** How a Run ended according to its final `agent_end`, without the Host's confirmation. */
export function settlementForTerminalEvent(
  event: Extract<AgentTransportEvent, { readonly type: 'agent_end' }>,
): RunSettlement {
  const unconfirmed = 'the Session Host closed before it confirmed the result.'
  if (event.reason === 'aborted') {
    return { exitCode: RUN_CLI_INTERRUPTED_EXIT, message: `Run interrupted; ${unconfirmed}` }
  }
  if (event.reason === 'error' || event.error) {
    return { exitCode: SESSION_CLI_EXIT.FAILURE, message: `Run failed; ${unconfirmed}` }
  }
  return { exitCode: SESSION_CLI_EXIT.SUCCESS, message: `Run finished; ${unconfirmed}` }
}

export function recentRunsQuery(target: RunTarget, cursor?: string): LocalSessionCommandPayload {
  return {
    contract: 'session-query-v2',
    request: {
      contractVersion: SESSION_QUERY_CONTRACT_VERSION,
      requestId: randomUUID(),
      query: {
        operation: 'turns',
        sessionId: target.sessionId,
        limit: RUN_RECONCILE_TURN_LIMIT,
        ...(cursor ? { cursor } : {}),
      },
    },
  }
}

export function settlementForWatchEnd(
  result: LocalSessionWatchResult,
  target?: RunTarget,
): RunSettlement {
  if (result.status === 'resync-required') {
    const detail =
      result.reason === 'host-restarted'
        ? 'the Session Host restarted'
        : `the Session Host event stream was lost (${result.reason})`
    return {
      exitCode: SESSION_CLI_EXIT.FAILURE,
      message: `${detail}, so the Run's result is unknown. Check it with 'openwaggle sessions turns ${target?.sessionId ?? '<session-id>'}'.`,
    }
  }
  return {
    exitCode: SESSION_CLI_EXIT.HOST_UNAVAILABLE,
    message: 'the Session Host closed the event stream before the Run finished.',
  }
}
