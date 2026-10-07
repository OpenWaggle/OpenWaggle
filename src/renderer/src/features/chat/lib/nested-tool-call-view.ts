import type { ChatNestedToolCall } from '@shared/types/chat-ui'
import type { ToolCallResultPayload } from './tool-call-block'

const EMPTY_TOOL_ARGS = '{}'
const NO_NESTED_CALLS: readonly ChatNestedToolCall[] = []

/** Live nested calls first; after reload, the record Pi kept on the persisted parent result. */
export function resolveNestedToolCalls(
  live: readonly ChatNestedToolCall[] | undefined,
  persisted: readonly ChatNestedToolCall[] | undefined,
) {
  return live ?? persisted ?? NO_NESTED_CALLS
}

/** The tool card result of a nested call: live output, Pi's recorded error, or bare completion. */
function nestedToolCallResult(call: ChatNestedToolCall): ToolCallResultPayload | undefined {
  if (call.output !== undefined) {
    return { content: call.output, state: call.state === 'error' ? 'error' : 'complete' }
  }
  if (call.state === 'error') {
    return {
      content: call.error ?? '',
      state: 'error',
      ...(call.error !== undefined ? { error: call.error } : {}),
    }
  }
  if (call.partialOutput !== undefined) return { content: call.partialOutput, state: 'partial' }
  return call.state === 'complete' ? { content: '', state: 'complete' } : undefined
}

export function nestedToolCallCard(call: ChatNestedToolCall) {
  return {
    name: call.name,
    args: call.arguments ?? EMPTY_TOOL_ARGS,
    state: call.state,
    result: nestedToolCallResult(call),
  }
}
