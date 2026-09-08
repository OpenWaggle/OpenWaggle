import { describe, expect, it } from 'vitest'
import type { MessageChatRow } from '../../lib/types-chat-row'
import {
  buildChatRows,
  createUserMessage,
  SessionBranchId,
  SessionId,
  SupportedModelId,
  type UIMessage,
} from './useBuildChatRows.test-utils'

describe('buildChatRows compaction summaries', () => {
  it('turns compaction summary messages into dedicated summary rows', () => {
    const compactionMessage: UIMessage = {
      id: 'compaction-summary',
      role: 'assistant',
      parts: [{ type: 'text', content: 'Compaction summary\n\nKept the failing test context.' }],
      metadata: {
        compactionSummary: {
          summary: 'Kept the failing test context.',
          tokensBefore: 123456,
          reason: 'threshold',
        },
      },
    }

    const rows = buildChatRows({
      messages: [createUserMessage('user-1', 'compact'), compactionMessage],
      isLoading: false,
      error: undefined,
      lastUserMessage: null,
      dismissedError: null,
      sessionId: 'session-compaction',
      waggleMetadataLookup: {},
      phase: { current: null, completed: [], totalElapsedMs: 0 },
    })

    expect(rows.map((row) => row.type)).toEqual(['message', 'compaction-summary'])
    expect(rows[1]).toMatchObject({
      type: 'compaction-summary',
      id: 'compaction-summary',
      summary: 'Kept the failing test context.',
      tokensBefore: 123456,
      reason: 'threshold',
    })
  })

  it.each([
    ['manual', 'manual'],
    ['threshold', 'automatic'],
    ['overflow', 'automatic'],
  ] as const)('appends an inline %s compaction status row', (reason, presentation) => {
    const rows = buildChatRows({
      messages: [createUserMessage('user-1', 'continue')],
      isLoading: true,
      error: undefined,
      lastUserMessage: 'continue',
      dismissedError: null,
      sessionId: 'session-compacting',
      waggleMetadataLookup: {},
      phase: { current: null, completed: [], totalElapsedMs: 0 },
      compactionStatus: {
        type: 'compacting',
        reason,
        summaryCountAtStart: 0,
        timeline: [
          {
            id: 'compaction-running',
            phase: 'running',
            reason,
            summaryCountAtStart: 0,
            messageCountAtStart: 1,
          },
        ],
      },
    })

    expect(rows.find((row) => row.type === 'compaction-status')).toEqual({
      type: 'compaction-status',
      id: 'compaction-running',
      anchorMessageCount: 1,
      announce: true,
      state: `${presentation}-running`,
    })
    expect(rows.some((row) => row.type === 'phase-indicator')).toBe(false)
  })

  it('keeps a completed status visible until its durable summary is hydrated', () => {
    const rows = buildChatRows({
      messages: [createUserMessage('user-1', 'continue')],
      isLoading: true,
      error: undefined,
      lastUserMessage: 'continue',
      dismissedError: null,
      sessionId: 'session-compacting',
      waggleMetadataLookup: {},
      phase: { current: { label: 'Thinking', elapsedMs: 0 }, completed: [], totalElapsedMs: 0 },
      compactionStatus: {
        type: 'completed',
        reason: 'threshold',
        summaryCountAtStart: 0,
        timeline: [
          {
            id: 'compaction-complete',
            phase: 'completed',
            reason: 'threshold',
            summaryCountAtStart: 0,
            messageCountAtStart: 1,
          },
        ],
      },
    })

    expect(rows.find((row) => row.type === 'compaction-status')).toEqual({
      type: 'compaction-status',
      id: 'compaction-complete',
      anchorMessageCount: 1,
      announce: true,
      state: 'automatic-complete',
    })
  })

  it('turns branch summary messages into dedicated summary rows', () => {
    const branchMessage: UIMessage = {
      id: 'branch-summary',
      role: 'assistant',
      parts: [{ type: 'text', content: 'Branch summary\n\nThe abandoned path edited tests.' }],
      metadata: {
        branchSummary: {
          summary: 'The abandoned path edited tests.',
        },
      },
    }

    const rows = buildChatRows({
      messages: [createUserMessage('user-1', 'branch'), branchMessage],
      isLoading: false,
      error: undefined,
      lastUserMessage: null,
      dismissedError: null,
      sessionId: 'session-branch-summary',
      waggleMetadataLookup: {},
      phase: { current: null, completed: [], totalElapsedMs: 0 },
    })

    expect(rows.map((row) => row.type)).toEqual(['message', 'branch-summary'])
    expect(rows[1]).toMatchObject({
      type: 'branch-summary',
      id: 'branch-summary',
      summary: 'The abandoned path edited tests.',
    })
  })
})

describe('buildChatRows interrupted runs', () => {
  it('places an interrupted run notice before transcript messages', () => {
    const rows = buildChatRows({
      messages: [createUserMessage('user-1', 'continue from last run')],
      isLoading: false,
      error: undefined,
      lastUserMessage: null,
      dismissedError: null,
      sessionId: 'session-interrupted',
      waggleMetadataLookup: {},
      phase: { current: null, completed: [], totalElapsedMs: 0 },
      interruptedRun: {
        runId: 'run-interrupted-1',
        sessionId: SessionId('session-interrupted'),
        branchId: SessionBranchId('session-interrupted:main'),
        runMode: 'classic',
        model: SupportedModelId('openai/gpt-5.4'),
        interruptedAt: 1000,
      },
    })

    expect(rows[0]).toMatchObject({
      type: 'interrupted-run',
      runId: 'run-interrupted-1',
      branchId: SessionBranchId('session-interrupted:main'),
    })
    expect(rows[1]).toMatchObject({ type: 'message' })
  })
})

// ─── isRunActive propagation ────────────────────────────────────────

describe('buildChatRows reasoning visibility', () => {
  it('keeps assistant rows that contain inline reasoning content', () => {
    const rows = buildChatRows({
      messages: [
        createUserMessage('user-1', 'think first'),
        {
          id: 'assistant-reasoning',
          role: 'assistant',
          parts: [{ type: 'thinking', content: 'Planning the next tool call.' }],
        },
      ],
      isLoading: false,
      error: undefined,
      lastUserMessage: null,
      dismissedError: null,
      sessionId: 'session-reasoning',
      waggleMetadataLookup: {},
      phase: { current: null, completed: [], totalElapsedMs: 0 },
    })

    const assistantRows = rows.filter(
      (row): row is MessageChatRow => row.type === 'message' && row.message.role === 'assistant',
    )

    expect(assistantRows).toHaveLength(1)
    expect(assistantRows[0]?.message.parts).toEqual([
      {
        type: 'thinking',
        content: 'Planning the next tool call.',
      },
    ])
  })
})

describe('buildChatRows isRunActive', () => {
  it('sets isRunActive on the last assistant row when isLoading is true', () => {
    const messages = [
      createUserMessage('user-1', 'hello'),
      {
        id: 'assistant-1',
        role: 'assistant' as const,
        parts: [{ type: 'text' as const, content: 'first reply' }],
      },
      {
        id: 'assistant-2',
        role: 'assistant' as const,
        parts: [{ type: 'text' as const, content: 'second reply' }],
      },
    ]

    const rows = buildChatRows({
      messages,
      isLoading: true,
      error: undefined,
      lastUserMessage: null,
      dismissedError: null,
      sessionId: 'session-active',
      waggleMetadataLookup: {},
      phase: { current: null, completed: [], totalElapsedMs: 0 },
    })

    const assistantRows = rows.filter(
      (row): row is MessageChatRow => row.type === 'message' && row.message.role === 'assistant',
    )

    // All assistant rows in an active run should have isRunActive true
    for (const row of assistantRows) {
      expect(row.isRunActive).toBe(true)
    }
  })

  it('sets isRunActive to false when isLoading is false', () => {
    const messages = [
      createUserMessage('user-1', 'hello'),
      {
        id: 'assistant-1',
        role: 'assistant' as const,
        parts: [{ type: 'text' as const, content: 'reply' }],
      },
    ]

    const rows = buildChatRows({
      messages,
      isLoading: false,
      error: undefined,
      lastUserMessage: null,
      dismissedError: null,
      sessionId: 'session-inactive',
      waggleMetadataLookup: {},
      phase: { current: null, completed: [], totalElapsedMs: 0 },
    })

    const assistantRows = rows.filter(
      (row): row is MessageChatRow => row.type === 'message' && row.message.role === 'assistant',
    )

    for (const row of assistantRows) {
      expect(row.isRunActive).toBe(false)
    }
  })
})

// ─── Waggle message metadata tests ────────────────────────────────
