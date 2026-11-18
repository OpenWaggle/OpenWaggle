import type { AgentEndEvent, ExtensionAPI } from '@earendil-works/pi-coding-agent'
import type { PiWaggleAgentEndHandler, PiWaggleExtensionContext } from './loop.js'

function lastAssistantIndex(messages: AgentEndEvent['messages']) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === 'assistant') return index
  }
  return -1
}

/**
 * The run's messages without the failed attempts a later response of the run replaced: Pi drops
 * an attempt it retries, or that overflowed and was compacted, from the model's context before
 * it continues.
 */
function withoutReplacedAttempts(messages: AgentEndEvent['messages']) {
  const last = lastAssistantIndex(messages)
  return messages.filter(
    (message, index) =>
      index >= last || message.role !== 'assistant' || message.stopReason !== 'error',
  )
}

/**
 * Runs `handler` with a turn's messages once Pi has settled its run. Pi emits `agent_end` for a
 * failed request it is about to retry, after overflow compaction, and before a queued
 * continuation, each with only that attempt's new messages; only `agent_settled` means nothing
 * follows. Advancing earlier would steer the next turn into the retry and judge the turn by its
 * failed attempt, so every `agent_end` until then is gathered into one. A run the user aborted
 * (Escape) settles with `aborted`: its turn is not judged and no next turn starts; `onAborted`
 * runs instead, and the run's messages are dropped, so they never join a later turn.
 */
export function onPiWaggleSettledAgentEnd(
  pi: Pick<ExtensionAPI, 'on'>,
  handler: PiWaggleAgentEndHandler,
  options: { readonly onAborted?: (ctx: PiWaggleExtensionContext) => void | Promise<void> } = {},
) {
  let messages: AgentEndEvent['messages'] = []
  let ended = false
  pi.on('agent_end', (event) => {
    messages = [...messages, ...event.messages]
    ended = true
  })
  pi.on('agent_settled', (event, ctx) => {
    if (!ended) return undefined
    const settled = withoutReplacedAttempts(messages)
    messages = []
    ended = false
    if (event.aborted) return options.onAborted?.(ctx)
    return handler({ type: 'agent_end', messages: settled }, ctx)
  })
}
