import {
  type AssistantMessage,
  createAssistantMessageEventStream,
  type Model,
} from '@earendil-works/pi-ai'
import { compact, prepareCompaction, SessionManager } from '@earendil-works/pi-coding-agent'
import { describe, expect, it, vi } from 'vitest'

describe('Pi Portable compaction', () => {
  it('uses the Codex four-part handoff contract in a versioned provider-neutral envelope', async () => {
    const response: AssistantMessage = {
      role: 'assistant',
      content: [{ type: 'text', text: 'Portable handoff' }],
      api: 'anthropic-messages',
      provider: 'portable-provider',
      model: 'portable-model',
      usage: {
        input: 100,
        output: 20,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 120,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: 'stop',
      timestamp: 2,
    }
    const streamFn: NonNullable<Parameters<typeof compact>[7]> = vi.fn((_model, context) => {
      const prompt = context.messages[0]
      expect(prompt?.role).toBe('user')
      const text = prompt?.role === 'user' ? JSON.stringify(prompt.content) : undefined
      expect(text).toContain('Current progress and key decisions made')
      expect(text).toContain('Important context, constraints, or user preferences')
      expect(text).toContain('What remains to be done (clear next steps)')
      expect(text).toContain('Any critical data, examples, or references needed to continue')
      const stream = createAssistantMessageEventStream()
      stream.end(response)
      return stream
    })
    const model: Model<'anthropic-messages'> = {
      id: 'portable-model',
      name: 'Portable model',
      provider: 'portable-provider',
      api: 'anthropic-messages',
      baseUrl: 'https://example.test',
      reasoning: false,
      input: ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 100_000,
      maxTokens: 10_000,
    }
    const preparation: Parameters<typeof compact>[0] = {
      firstKeptEntryId: 'kept-entry',
      messagesToSummarize: [{ role: 'user', content: 'Old context', timestamp: 1 }],
      messagesForNativeCompaction: [{ role: 'user', content: 'All context', timestamp: 1 }],
      turnPrefixMessages: [],
      isSplitTurn: false,
      tokensBefore: 80_000,
      fileOps: {
        read: new Set(['/repo/read.ts']),
        written: new Set<string>(),
        edited: new Set(['/repo/edited.ts']),
      },
      settings: {
        enabled: true,
        reserveTokens: 16_384,
        keepRecentTokens: 20_000,
        thresholdPercent: 80,
      },
    }

    const result = await compact(
      preparation,
      model,
      'test-key',
      undefined,
      undefined,
      undefined,
      undefined,
      streamFn,
    )

    expect(result.summary).toContain('Portable handoff')
    expect(result.details).toEqual({
      schemaVersion: 1,
      mechanism: 'portable',
      contract: 'codex-handoff-v1',
      readFiles: ['/repo/read.ts'],
      modifiedFiles: ['/repo/edited.ts'],
    })
  })

  it('clamps the 20k recent tail only when the active model hard window requires it', () => {
    const sessionManager = SessionManager.inMemory('/repo')
    sessionManager.appendMessage({
      role: 'user',
      content: `old-user-${'x'.repeat(20_000)}`,
      timestamp: 1,
    })
    const oldAssistantId = sessionManager.appendMessage({
      role: 'assistant',
      content: [{ type: 'text', text: `old-assistant-${'y'.repeat(20_000)}` }],
      api: 'anthropic-messages',
      provider: 'portable-provider',
      model: 'portable-model',
      usage: {
        input: 1,
        output: 1,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 2,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: 'stop',
      timestamp: 2,
    })
    sessionManager.appendMessage({
      role: 'user',
      content: `recent-user-${'a'.repeat(20_000)}`,
      timestamp: 3,
    })
    sessionManager.appendMessage({
      role: 'assistant',
      content: [{ type: 'text', text: `recent-assistant-${'b'.repeat(20_000)}` }],
      api: 'anthropic-messages',
      provider: 'portable-provider',
      model: 'portable-model',
      usage: {
        input: 1,
        output: 1,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 2,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: 'stop',
      timestamp: 4,
    })
    const model: Model<'anthropic-messages'> = {
      id: 'portable-model',
      name: 'Portable model',
      provider: 'portable-provider',
      api: 'anthropic-messages',
      baseUrl: 'https://example.test',
      reasoning: false,
      input: ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 30_000,
      maxTokens: 10_000,
    }

    const preparation = prepareCompaction(
      sessionManager.getBranch(),
      {
        enabled: true,
        reserveTokens: 16_384,
        keepRecentTokens: 20_000,
        thresholdPercent: 80,
      },
      model,
    )

    expect(preparation?.firstKeptEntryId).toBe(oldAssistantId)
    expect(preparation?.isSplitTurn).toBe(true)
  })
})
