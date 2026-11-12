import type { LocalSessionCommandResult } from '@shared/types/local-session-protocol'
import type {
  ScheduledTaskAttentionReason,
  ScheduledTaskRunReason,
} from '@shared/types/scheduled-task'
import { LocalSessionCommandAuthorizationError } from '../errors'
import type { ScheduledTaskRunSettlement } from '../ports/scheduled-task-repository'
import { sessionCommandFailureMessage } from './session-command-failure-message'

const MESSAGE_LIMIT = 500

export interface ScheduledTaskDispatchSettlement {
  readonly run: ScheduledTaskRunSettlement
  /** Set when the refusal needs the user: the task stops until they turn it back on. */
  readonly attention?: ScheduledTaskAttentionReason
}

function bounded(message: string) {
  return message.length > MESSAGE_LIMIT ? `${message.slice(0, MESSAGE_LIMIT - 1)}…` : message
}

function skipped(reason: ScheduledTaskRunReason, message: string) {
  const settlement: ScheduledTaskDispatchSettlement = {
    run: { status: 'skipped', reason, message },
  }
  return settlement
}

function failed(
  reason: ScheduledTaskRunReason,
  message: string,
  attention?: ScheduledTaskAttentionReason,
) {
  const settlement: ScheduledTaskDispatchSettlement = {
    run: { status: 'failed', reason, message: bounded(message) },
    ...(attention ? { attention } : {}),
  }
  return settlement
}

/** What a refused request means for the task: a busy or full Host skips; the rest stop it. */
function refusalSettlement(code: string, kind: 'heartbeat' | 'launch') {
  if (code === 'run_already_active') {
    return skipped('session-busy', 'The Session started a Run before this one could.')
  }
  if (code === 'host_run_ceiling_reached' || code === 'host_capacity_reached') {
    return skipped('host-capacity-reached', 'Active Workers was full.')
  }
  if (code === 'parent_concurrency_limit_reached') {
    return skipped(
      'host-capacity-reached',
      "The Worker's parent was running as many Workers as it may.",
    )
  }
  if (code.includes('model')) {
    return failed(
      'model-unavailable',
      `The task's model is not available (${code}).`,
      'model-unavailable',
    )
  }
  if (code.includes('agent_definition') || code.includes('agent-definition')) {
    return failed(
      'agent-definition-invalid',
      `The task's Agent definition cannot be used (${code}).`,
      'agent-definition-invalid',
    )
  }
  if (code.includes('project')) {
    return failed(
      'project-missing',
      `The task's project cannot be used (${code}).`,
      'project-missing',
    )
  }
  return kind === 'launch'
    ? failed('launch-refused', `The Session launch was refused (${code}).`, 'launch-refused')
    : failed('dispatch-failed', `The Run start was refused (${code}).`)
}

export function settlementOfDispatch(result: LocalSessionCommandResult) {
  if (result.contract === 'session-control-v2') {
    const outcome = result.response.outcome
    if (outcome.effect === 'started-run') {
      const settlement: ScheduledTaskDispatchSettlement = {
        run: { status: 'started', sessionId: outcome.sessionId, runId: outcome.runId },
      }
      return settlement
    }
    if (outcome.effect === 'rejected') return refusalSettlement(outcome.code, 'heartbeat')
    return failed('dispatch-failed', `The Session answered ${outcome.effect} instead of starting.`)
  }
  if (result.contract === 'session-lifecycle-v2') {
    const outcome = result.response.outcome
    if (outcome.effect === 'launched-root') {
      const settlement: ScheduledTaskDispatchSettlement = {
        run: { status: 'started', sessionId: outcome.sessionId, runId: outcome.runId },
      }
      return settlement
    }
    if (outcome.effect === 'rejected') return refusalSettlement(outcome.code, 'launch')
  }
  return failed('dispatch-failed', 'The Session Host returned an unexpected answer.')
}

function errorText(error: unknown) {
  const message = sessionCommandFailureMessage(error)
  return message || (error instanceof Error ? error.message : String(error))
}

export function settlementOfFailure(error: unknown) {
  if (error instanceof LocalSessionCommandAuthorizationError) {
    return failed(
      'creator-authority-revoked',
      `Whoever created this task may no longer do this (${error.code}).`,
      'creator-authority-revoked',
    )
  }
  const message = errorText(error)
  if (/model/i.test(message)) return failed('model-unavailable', message, 'model-unavailable')
  if (/agent definition/i.test(message)) {
    return failed('agent-definition-invalid', message, 'agent-definition-invalid')
  }
  if (/project/i.test(message) && /(unknown|not found|missing|catalog)/i.test(message)) {
    return failed('project-missing', message, 'project-missing')
  }
  return failed('dispatch-failed', message)
}
