import type { UIMessage } from '@shared/types/chat-ui'
import type { JsonObject } from '@shared/types/json'
import { parseToolArgs } from './tool-args'
import { isKnownSessionsAction, SESSIONS_TOOL_NAME } from './tool-labels-sessions'

type MessagePart = UIMessage['parts'][number]

/**
 * `wait` calls get no row, as in Codex (ADR 0054): a spawn row's live state shows what the wait
 * is for. While arguments stream, a call shows only once its action is a whole action name, since
 * Pi's partial parse yields `"w"`, `"wai"` on the way to `"wait"`; a wait never flashes a row.
 */
export function isHiddenSessionsToolCall(name: string, args: JsonObject, state?: string) {
  if (name !== SESSIONS_TOOL_NAME) return false
  const action = typeof args.action === 'string' ? args.action : null
  if (action === 'wait') return true
  return state === 'input-streaming' && (action === null || !isKnownSessionsAction(action))
}

function isHiddenToolCallPart(part: MessagePart) {
  return (
    part.type === 'tool-call' &&
    isHiddenSessionsToolCall(part.name, parseToolArgs(part.arguments), part.state)
  )
}

/** A tool call the transcript shows: anything but a hidden Worker wait. */
export function isShownToolCallPart(part: MessagePart) {
  return part.type === 'tool-call' && !isHiddenToolCallPart(part)
}

/**
 * Whether a message shows nothing but hidden Worker waits and their results, so its row would be
 * an empty frame. Such rows are left out of the transcript.
 */
export function showsOnlyHiddenSessionsToolCalls(parts: readonly MessagePart[]) {
  let hidden = 0
  for (const part of parts) {
    if (part.type === 'tool-result') continue
    if (isHiddenToolCallPart(part)) {
      hidden += 1
      continue
    }
    if ((part.type === 'text' || part.type === 'thinking') && !part.content.trim()) continue
    return false
  }
  return hidden > 0
}
