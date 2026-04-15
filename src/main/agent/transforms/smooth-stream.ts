import { STREAM_TIMEOUT } from '@shared/constants/time'
import type { AgentStreamChunk, AgentTextMessageContentChunk } from '@shared/types/stream'

/**
 * Regex that matches a word followed by whitespace — the smallest readable unit
 * for streaming text. Mirrors the chunking strategy used by Vercel AI SDK's
 * `smoothStream({ chunking: 'word' })`.
 *
 * TODO: For CJK languages (Chinese/Japanese/Korean) which don't use whitespace
 * between words, consider using `Intl.Segmenter` with `granularity: 'word'`
 * to produce natural word boundaries.
 */
const WORD_BOUNDARY_REGEX = /\S+\s+/m

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

/**
 * Wraps an `AsyncIterable<AgentStreamChunk>` to smooth text delivery.
 *
 * Large text deltas (common with Anthropic's thinking-enabled models like Opus,
 * which batch ~250 chars per SSE event) are buffered and re-emitted word-by-word
 * with a 10ms delay between each word. Non-text chunks pass through immediately,
 * flushing any buffered text first.
 *
 * This is the domain-type equivalent of Vercel AI SDK's `smoothStream` transform,
 * operating on `AgentStreamChunk` instead of vendor `StreamChunk`.
 */
export async function* smoothStream(
  source: AsyncIterable<AgentStreamChunk>,
): AsyncIterable<AgentStreamChunk> {
  let buffer = ''
  let activeMessageId = ''

  for await (const chunk of source) {
    if (chunk.type !== 'TEXT_MESSAGE_CONTENT') {
      // Flush any remaining buffer before passing non-text chunks through
      if (buffer.length > 0) {
        yield makeTextChunk(activeMessageId, buffer)
        buffer = ''
      }
      yield chunk
      continue
    }

    activeMessageId = chunk.messageId
    buffer += chunk.delta

    let match: RegExpExecArray | null = WORD_BOUNDARY_REGEX.exec(buffer)
    while (match !== null) {
      const word = buffer.slice(0, match.index) + match[0]
      yield makeTextChunk(activeMessageId, word)
      buffer = buffer.slice(word.length)
      await delay(STREAM_TIMEOUT.SMOOTH_DELAY_MS)
      match = WORD_BOUNDARY_REGEX.exec(buffer)
    }
  }

  // Flush any trailing partial word (no trailing whitespace)
  if (buffer.length > 0) {
    yield makeTextChunk(activeMessageId, buffer)
  }
}

function makeTextChunk(messageId: string, delta: string): AgentTextMessageContentChunk {
  return { type: 'TEXT_MESSAGE_CONTENT', messageId, delta, timestamp: Date.now() }
}
