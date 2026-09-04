import type { Model } from '@earendil-works/pi-ai'
import {
  DEFAULT_COMPACTION_SETTINGS,
  findCutPoint,
  selectCompactionMechanism,
  shouldCompact,
} from '@earendil-works/pi-coding-agent'
import { describe, expect, it } from 'vitest'

describe('Pi compaction policy', () => {
  it('triggers at the configured percentage of the active model context window', () => {
    const settings = {
      ...DEFAULT_COMPACTION_SETTINGS,
      thresholdPercent: 80,
    }

    expect(shouldCompact(79_999, 100_000, settings)).toBe(false)
    expect(shouldCompact(80_000, 100_000, settings)).toBe(true)
  })

  it('preserves the output reserve when the configured percentage is too late', () => {
    const settings = {
      ...DEFAULT_COMPACTION_SETTINGS,
      thresholdPercent: 95,
      reserveTokens: 16_384,
    }

    expect(shouldCompact(83_615, 100_000, settings)).toBe(false)
    expect(shouldCompact(83_616, 100_000, settings)).toBe(true)
  })

  it('selects Native only from an explicit transport capability', () => {
    const baseModel = {
      id: 'model',
      name: 'Model',
      provider: 'provider',
      api: 'openai-responses',
      baseUrl: 'https://example.test/v1',
      reasoning: true,
      input: ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 100_000,
      maxTokens: 10_000,
    } satisfies Model<'openai-responses'>
    const nativeModel: Model<'openai-responses'> = {
      ...baseModel,
      compat: { supportsCompaction: true },
    }
    const completionsModel: Model<'openai-completions'> = {
      ...baseModel,
      api: 'openai-completions',
    }
    const azureModel: Model<'azure-openai-responses'> = {
      ...baseModel,
      api: 'azure-openai-responses',
      compat: { supportsCompaction: true },
    }

    expect(selectCompactionMechanism(baseModel)).toBe('portable')
    expect(selectCompactionMechanism(nativeModel)).toBe('native')
    expect(selectCompactionMechanism(completionsModel)).toBe('portable')
    expect(selectCompactionMechanism(azureModel)).toBe('portable')
  })

  it('retains an oversized tool call and result as one atomic recent unit', () => {
    const entries = [
      {
        type: 'message' as const,
        id: 'user',
        parentId: null,
        timestamp: '2026-01-01T00:00:00.000Z',
        message: { role: 'user' as const, content: 'use the tool', timestamp: 1 },
      },
      {
        type: 'message' as const,
        id: 'assistant-tool',
        parentId: 'user',
        timestamp: '2026-01-01T00:00:01.000Z',
        message: {
          role: 'assistant' as const,
          content: [{ type: 'toolCall' as const, id: 'tool-1', name: 'read', arguments: {} }],
          api: 'openai-responses' as const,
          provider: 'provider',
          model: 'model',
          usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
          stopReason: 'toolUse' as const,
          timestamp: 2,
        },
      },
      {
        type: 'message' as const,
        id: 'tool-result',
        parentId: 'assistant-tool',
        timestamp: '2026-01-01T00:00:02.000Z',
        message: {
          role: 'toolResult' as const,
          toolCallId: 'tool-1',
          toolName: 'read',
          content: [{ type: 'text' as const, text: 'x'.repeat(10_000) }],
          isError: false,
          timestamp: 3,
        },
      },
    ]

    expect(findCutPoint(entries, 0, entries.length, 1)).toEqual({
      firstKeptEntryIndex: 1,
      turnStartIndex: 0,
      isSplitTurn: true,
    })
  })
})
