import type { UIMessage } from '@shared/types/chat-ui'
import type { JsonObject } from '@shared/types/json'
import { parseToolArgs } from './tool-args'
import { isWholeSessionsAction, SESSIONS_TOOL_NAME } from './tool-labels-sessions'

type MessagePart = UIMessage['parts'][number]

/**
 * The `"action"` of arguments cut short, as Pi codemode previews a call's arguments; keys keep the
 * script's order, so it need not come first. Sessions-tool arguments nest no `action` key.
 */
const PREVIEW_ACTION = /(?<!\\)"action"\s*:\s*"([a-z_]+)"/

/**
 * `wait` calls get no row, as in Codex (ADR 0054): a spawn row's live state shows what the wait
 * is for. While arguments stream, a call shows only once its action is a whole action name, since
 * Pi's partial parse yields `"w"`, `"wai"` on the way to `"wait"`; a wait never flashes a row.
 */
export function isHiddenSessionsToolCall(name: string, args: JsonObject, state?: string) {
  if (name !== SESSIONS_TOOL_NAME) return false
  const action = typeof args.action === 'string' ? args.action : null
  if (action === 'wait') return true
  return state === 'input-streaming' && (action === null || !isWholeSessionsAction(action))
}

/**
 * The same rule for a call known only by its JSON arguments, which a script's call list cuts to
 * a preview: an unparseable preview still names its action, unless the cut fell before it.
 */
export function isHiddenSessionsToolCallJson(name: string, argsJson: string, state?: string) {
  if (name !== SESSIONS_TOOL_NAME) return false
  const args = parseToolArgs(argsJson)
  if (typeof args.action === 'string') return isHiddenSessionsToolCall(name, args, state)
  const previewed = PREVIEW_ACTION.exec(argsJson)?.[1]
  return isHiddenSessionsToolCall(name, previewed ? { action: previewed } : args, state)
}

function isHiddenToolCallPart(part: MessagePart) {
  // The name is checked before the arguments are parsed: this runs for every call on each delta.
  return (
    part.type === 'tool-call' && isHiddenSessionsToolCallJson(part.name, part.arguments, part.state)
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
