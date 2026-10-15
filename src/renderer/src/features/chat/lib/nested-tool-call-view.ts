import type { NestedToolCallRecord, NestedToolCalls } from '@shared/types/tools'
import { NESTED_TOOL_CALL_LIMITS } from '@shared/utils/nested-tool-calls'
import type { ToolCallResultPayload } from './tool-call-block'
import { isHiddenSessionsToolCall } from './tool-labels-sessions'

const EMPTY_TOOL_ARGS = '{}'

/**
 * A call another tool made through Pi `ctx.executeTool()`, for example from codemode, as its card
 * under the calling tool's card shows it. Pi keeps no result for it.
 */
export interface NestedToolCallView {
  readonly id: string
  readonly name: string
  /** JSON arguments; absent when the record left them out for size. */
  readonly arguments?: string
  readonly argumentsOmitted: boolean
  /** `unfinished`: the call was still running when the calling tool finished. */
  readonly state: 'executing' | 'complete' | 'error' | 'unfinished'
  /** Truncated error text of a failed call. */
  readonly error?: string
}

export interface NestedToolCallsView {
  readonly calls: readonly NestedToolCallView[]
  /** A note for calls left out of the record past its maximum, or null when none were. */
  readonly omittedCalls: string | null
}

const NO_NESTED_CALLS: NestedToolCallsView = { calls: [], omittedCalls: null }

function callState(record: NestedToolCallRecord, parentFinished: boolean) {
  if (record.status === 'ok') return 'complete'
  if (record.status === 'error') return 'error'
  return parentFinished ? 'unfinished' : 'executing'
}

function callView(record: NestedToolCallRecord, parentFinished: boolean): NestedToolCallView {
  return {
    id: record.id,
    name: record.name,
    ...(record.args !== undefined ? { arguments: JSON.stringify(record.args) } : {}),
    argumentsOmitted: record.args === undefined && record.argsBytes !== undefined,
    state: callState(record, parentFinished),
    ...(record.error !== undefined ? { error: record.error } : {}),
  }
}

/**
 * OpenWaggle's live record counts dropped calls. Pi's record only says it is incomplete, which a
 * full record is only when Pi dropped calls past its maximum.
 */
function omittedCallsNote(record: NestedToolCalls) {
  if (record.droppedCalls !== undefined && record.droppedCalls > 0) {
    return record.droppedCalls === 1
      ? '1 more tool call not shown'
      : `${String(record.droppedCalls)} more tool calls not shown`
  }
  return !record.complete && record.calls.length >= NESTED_TOOL_CALL_LIMITS.maxCalls
    ? 'More tool calls not shown'
    : null
}

/**
 * The nested calls of a tool call: the live record while the Run streams or after a reconnect,
 * otherwise the record Pi kept on the persisted result. A call still unfinished runs until the
 * calling tool finishes.
 */
export function nestedToolCallsView(
  live: NestedToolCalls | undefined,
  persisted: NestedToolCalls | undefined,
  parentFinished: boolean,
): NestedToolCallsView {
  const record = live ?? persisted
  if (!record) return NO_NESTED_CALLS
  // A Worker wait gets no row here either, so the list, its count and its frame agree.
  const shown = record.calls.filter((call) => !isHiddenSessionsToolCall(call.name, call.args ?? {}))
  return {
    calls: shown.map((call) => callView(call, parentFinished)),
    omittedCalls: omittedCallsNote(record),
  }
}

/** The tool card result of a nested call: Pi's recorded error, or bare completion. */
function nestedToolCallResult(call: NestedToolCallView): ToolCallResultPayload | undefined {
  if (call.state === 'error') {
    return {
      content: call.error ?? '',
      state: 'error',
      ...(call.error !== undefined ? { error: call.error } : {}),
    }
  }
  return call.state === 'complete' ? { content: '', state: 'complete' } : undefined
}

export function nestedToolCallCard(call: NestedToolCallView) {
  return {
    name: call.name,
    args: call.arguments ?? EMPTY_TOOL_ARGS,
    state: call.state,
    result: nestedToolCallResult(call),
  }
}
