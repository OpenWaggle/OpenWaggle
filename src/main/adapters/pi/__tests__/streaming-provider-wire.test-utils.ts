import type { AssistantMessageEventStream } from '@earendil-works/pi-ai'
import { normalizeContext } from '@earendil-works/pi-ai/utils/transcript'
import { splitIntoDeltas, writeFileArguments } from './bedrock-event-stream.test-utils'

/** The write call every streaming provider case sends, and the wire helpers they share. */

export const JSON_ARGUMENTS = writeFileArguments(64 * 1024)
export const DELTAS = splitIntoDeltas(JSON_ARGUMENTS)
export const CONTEXT = normalizeContext({
  messages: [{ role: 'user', content: 'write the file', timestamp: 0 }],
})
export const USAGE = { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2 }

export function sse(events: readonly unknown[], options: { readonly named?: boolean } = {}) {
  return events
    .map((event) => {
      const data = `data: ${JSON.stringify(event)}\n\n`
      if (!options.named || typeof event !== 'object' || event === null || !('type' in event)) {
        return data
      }
      return `event: ${String(event.type)}\n${data}`
    })
    .join('')
}

export async function finalMessage(events: AssistantMessageEventStream) {
  for await (const _event of events) {
    // Drain the stream; only the final message matters here.
  }
  return events.result()
}
