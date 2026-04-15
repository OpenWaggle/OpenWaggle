import type { AgentStreamChunk } from '@shared/types/stream'
import * as Effect from 'effect/Effect'
import { describe, expect, it, vi } from 'vitest'
import { ContextCompactionService } from '../../ports/context-compaction-service'
import { ContextCompactionLive } from '../context-compaction-adapter'

/** Build a mock async iterable that yields the given chunks. */
function mockChunks(...deltas: string[]): AsyncIterable<AgentStreamChunk> {
  return {
    [Symbol.asyncIterator]() {
      let index = 0
      return {
        next(): Promise<IteratorResult<AgentStreamChunk>> {
          if (index < deltas.length) {
            const chunk: AgentStreamChunk = {
              type: 'TEXT_MESSAGE_CONTENT',
              messageId: 'm1',
              delta: deltas[index++] ?? '',
              timestamp: Date.now(),
            }
            return Promise.resolve({ value: chunk, done: false })
          }
          return Promise.resolve({ value: undefined, done: true })
        },
      }
    },
  }
}

vi.mock('../../logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}))

function runWithService<A>(
  effect: Effect.Effect<A, unknown, ContextCompactionService>,
): Promise<A> {
  return Effect.runPromise(Effect.provide(effect, ContextCompactionLive))
}

describe('ContextCompactionService', () => {
  describe('needsFullCompaction', () => {
    it('returns false when tokens are below threshold', async () => {
      const messages = [
        { role: 'user' as const, content: 'hello' },
        { role: 'assistant' as const, content: 'hi' },
      ]
      const result = await runWithService(
        Effect.gen(function* () {
          const service = yield* ContextCompactionService
          return yield* service.needsFullCompaction(messages, 128_000)
        }),
      )
      expect(result).toBe(false)
    })

    it('returns true when tokens exceed 80% threshold', async () => {
      // Create a message that exceeds 80% of a tiny context window
      const largeContent = 'a'.repeat(400) // ~100 tokens
      const messages = [{ role: 'user' as const, content: largeContent }]
      const result = await runWithService(
        Effect.gen(function* () {
          const service = yield* ContextCompactionService
          // 100 estimated tokens, 80% of 100 = 80 → should trigger
          return yield* service.needsFullCompaction(messages, 100)
        }),
      )
      expect(result).toBe(true)
    })

    it('returns false when exactly at threshold', async () => {
      // 32 chars = 8 tokens + 4 overhead = 12 tokens
      // 80% of 15 = 12 → NOT exceeded (equal)
      const messages = [{ role: 'user' as const, content: 'a'.repeat(32) }]
      const result = await runWithService(
        Effect.gen(function* () {
          const service = yield* ContextCompactionService
          return yield* service.needsFullCompaction(messages, 15)
        }),
      )
      expect(result).toBe(false)
    })
  })

  describe('compact', () => {
    it('produces a summary message and preserves recent user messages', async () => {
      const messages = [
        { role: 'user' as const, content: 'Please fix the bug in auth.ts' },
        {
          role: 'assistant' as const,
          content: 'I read the file and found the issue.',
          toolCalls: [
            {
              id: 'tc1',
              type: 'function' as const,
              function: { name: 'readFile', arguments: '{"path":"auth.ts"}' },
            },
          ],
        },
        { role: 'tool' as const, content: 'file contents...', toolCallId: 'tc1' },
        { role: 'user' as const, content: 'Now also fix the tests' },
      ]

      const mockChatStream = vi.fn(() => mockChunks('Summary: Fixed auth bug.'))
      const mockAdapter = {} as never

      const result = await runWithService(
        Effect.gen(function* () {
          const service = yield* ContextCompactionService
          return yield* service.compact({
            messages,
            systemPrompt: 'You are helpful.',
            contextWindowTokens: 128_000,
            chatStream: mockChatStream,
            adapter: mockAdapter,
          })
        }),
      )

      // Summary message should be first
      expect(result.messages[0]?.role).toBe('user')
      expect(result.messages[0]?.content).toContain('[Context Summary')
      expect(result.messages[0]?.content).toContain('Summary: Fixed auth bug.')

      // Should have result metrics
      expect(result.result.tier).toBe('full')
      expect(result.result.originalTokenEstimate).toBeGreaterThan(0)
      expect(result.result.compactedTokenEstimate).toBeGreaterThan(0)
      expect(result.result.summaryTokens).toBeGreaterThan(0)
      expect(result.result.recentMessagesPreserved).toBeGreaterThan(0)
    })

    it('preserves the last assistant message and its tool results', async () => {
      const messages = [
        { role: 'user' as const, content: 'read the file' },
        {
          role: 'assistant' as const,
          content: 'Reading...',
          toolCalls: [
            {
              id: 'tc1',
              type: 'function' as const,
              function: { name: 'readFile', arguments: '{}' },
            },
          ],
        },
        { role: 'tool' as const, content: 'file content', toolCallId: 'tc1' },
      ]

      const mockStreamFn = () => mockChunks('Summary text.')

      const result = await runWithService(
        Effect.gen(function* () {
          const service = yield* ContextCompactionService
          return yield* service.compact({
            messages,
            systemPrompt: '',
            contextWindowTokens: 128_000,
            chatStream: vi.fn(() => mockStreamFn()),
            adapter: {} as never,
          })
        }),
      )

      // Last assistant and its tool result should be preserved
      const assistantMsg = result.messages.find((m) => m.role === 'assistant')
      expect(assistantMsg?.content).toBe('Reading...')
      const toolMsg = result.messages.find((m) => m.role === 'tool')
      expect(toolMsg?.content).toBe('file content')
    })

    it('includes custom instructions in the summarization prompt', async () => {
      const mockChatStream = vi.fn(() => mockChunks('Summary.'))

      await runWithService(
        Effect.gen(function* () {
          const service = yield* ContextCompactionService
          return yield* service.compact({
            messages: [{ role: 'user' as const, content: 'test' }],
            systemPrompt: '',
            contextWindowTokens: 128_000,
            customInstructions: 'Preserve all file paths',
            chatStream: mockChatStream,
            adapter: {} as never,
          })
        }),
      )

      // The chatStream should have been called with messages that include custom instructions
      expect(mockChatStream).toHaveBeenCalledOnce()
      expect(mockChatStream).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({
              content: expect.stringContaining('Preserve all file paths'),
            }),
          ]),
        }),
      )
    })

    it('returns original messages when summary is empty', async () => {
      const messages = [{ role: 'user' as const, content: 'hello' }]

      const result = await runWithService(
        Effect.gen(function* () {
          const service = yield* ContextCompactionService
          return yield* service.compact({
            messages,
            systemPrompt: '',
            contextWindowTokens: 128_000,
            chatStream: vi.fn(() => mockChunks('   ')),
            adapter: {} as never,
          })
        }),
      )

      expect(result.messages).toHaveLength(1)
      expect(result.result.summaryTokens).toBe(0)
    })
  })
})
