import type { AgentStreamChunk, AgentTextMessageContentChunk } from '@shared/types/stream'
import { describe, expect, it, vi } from 'vitest'
import { smoothStream } from '../smooth-stream'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function* chunksFrom(items: AgentStreamChunk[]): AsyncIterable<AgentStreamChunk> {
  for (const item of items) {
    yield item
  }
}

function textChunk(delta: string, messageId = 'msg-1'): AgentTextMessageContentChunk {
  return { type: 'TEXT_MESSAGE_CONTENT', messageId, delta, timestamp: 0 }
}

async function collectChunks(source: AsyncIterable<AgentStreamChunk>): Promise<AgentStreamChunk[]> {
  const result: AgentStreamChunk[] = []
  for await (const chunk of source) {
    result.push(chunk)
  }
  return result
}

function textDeltas(chunks: AgentStreamChunk[]): string[] {
  return chunks
    .filter((c): c is AgentTextMessageContentChunk => c.type === 'TEXT_MESSAGE_CONTENT')
    .map((c) => c.delta)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('smoothStream', () => {
  // Use fake timers to avoid real 10ms delays in tests
  it('splits a multi-word delta into word-by-word chunks', async () => {
    vi.useFakeTimers()
    try {
      const input = [textChunk('Hello world, how are you? ')]
      const promise = collectChunks(smoothStream(chunksFrom(input)))

      // Advance timers enough for all words to flush
      await vi.advanceTimersByTimeAsync(500)
      const result = await promise
      const deltas = textDeltas(result)

      expect(deltas).toEqual(['Hello ', 'world, ', 'how ', 'are ', 'you? '])
    } finally {
      vi.useRealTimers()
    }
  })

  it('buffers a trailing partial word until stream ends', async () => {
    vi.useFakeTimers()
    try {
      const input = [textChunk('Hello world')]
      const promise = collectChunks(smoothStream(chunksFrom(input)))

      await vi.advanceTimersByTimeAsync(500)
      const result = await promise
      const deltas = textDeltas(result)

      // "Hello " emitted via regex, "world" flushed at stream end
      expect(deltas).toEqual(['Hello ', 'world'])
    } finally {
      vi.useRealTimers()
    }
  })

  it('flushes buffer before passing non-text chunks through', async () => {
    vi.useFakeTimers()
    try {
      const toolStart: AgentStreamChunk = {
        type: 'TOOL_CALL_START',
        toolCallId: 'tc-1',
        toolName: 'readFile',
        timestamp: 0,
      }
      const input = [textChunk('Partial text'), toolStart]
      const promise = collectChunks(smoothStream(chunksFrom(input)))

      await vi.advanceTimersByTimeAsync(500)
      const result = await promise

      // Buffer should flush "Partial text" before the tool call
      expect(result[0]).toEqual(
        expect.objectContaining({ type: 'TEXT_MESSAGE_CONTENT', delta: 'Partial ' }),
      )
      expect(result[1]).toEqual(
        expect.objectContaining({ type: 'TEXT_MESSAGE_CONTENT', delta: 'text' }),
      )
      expect(result[2]).toEqual(expect.objectContaining({ type: 'TOOL_CALL_START' }))
    } finally {
      vi.useRealTimers()
    }
  })

  it('passes non-text chunks through immediately without buffering', async () => {
    vi.useFakeTimers()
    try {
      const runStarted: AgentStreamChunk = {
        type: 'RUN_STARTED',
        runId: 'r-1',
        timestamp: 0,
      }
      const runFinished: AgentStreamChunk = {
        type: 'RUN_FINISHED',
        runId: 'r-1',
        finishReason: 'stop',
        timestamp: 0,
      }
      const input = [runStarted, runFinished]
      const promise = collectChunks(smoothStream(chunksFrom(input)))

      await vi.advanceTimersByTimeAsync(100)
      const result = await promise

      expect(result).toHaveLength(2)
      expect(result[0]).toEqual(expect.objectContaining({ type: 'RUN_STARTED' }))
      expect(result[1]).toEqual(expect.objectContaining({ type: 'RUN_FINISHED' }))
    } finally {
      vi.useRealTimers()
    }
  })

  it('accumulates buffer across multiple text deltas', async () => {
    vi.useFakeTimers()
    try {
      // Simulate two deltas that together form complete words
      const input = [textChunk('Hel'), textChunk('lo world ')]
      const promise = collectChunks(smoothStream(chunksFrom(input)))

      await vi.advanceTimersByTimeAsync(500)
      const result = await promise
      const deltas = textDeltas(result)

      expect(deltas).toEqual(['Hello ', 'world '])
    } finally {
      vi.useRealTimers()
    }
  })

  it('preserves messageId from source chunks', async () => {
    vi.useFakeTimers()
    try {
      const input = [textChunk('Hello world ', 'custom-msg')]
      const promise = collectChunks(smoothStream(chunksFrom(input)))

      await vi.advanceTimersByTimeAsync(500)
      const result = await promise

      for (const chunk of result) {
        if (chunk.type === 'TEXT_MESSAGE_CONTENT') {
          expect(chunk.messageId).toBe('custom-msg')
        }
      }
    } finally {
      vi.useRealTimers()
    }
  })

  it('handles empty stream', async () => {
    const input: AgentStreamChunk[] = []
    const result = await collectChunks(smoothStream(chunksFrom(input)))
    expect(result).toHaveLength(0)
  })

  it('handles large Anthropic-style deltas (~250 chars)', async () => {
    vi.useFakeTimers()
    try {
      // Simulate a large delta typical of Anthropic Opus
      const words = Array.from({ length: 40 }, (_, i) => `word${i}`)
      const largeDelta = `${words.join(' ')} `
      const input = [textChunk(largeDelta)]
      const promise = collectChunks(smoothStream(chunksFrom(input)))

      await vi.advanceTimersByTimeAsync(2000)
      const result = await promise
      const deltas = textDeltas(result)

      // Each word should be emitted individually with trailing space
      expect(deltas).toHaveLength(40)
      expect(deltas[0]).toBe('word0 ')
      expect(deltas[39]).toBe('word39 ')
    } finally {
      vi.useRealTimers()
    }
  })
})
