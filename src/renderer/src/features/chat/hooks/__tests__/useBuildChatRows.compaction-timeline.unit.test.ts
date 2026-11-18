import { describe, expect, it } from 'vitest'
import {
  acknowledgeCompactionStatus,
  withoutLatestRunningCompaction,
} from '../../lib/compaction-lifecycle'
import { buildChatRows, createUserMessage, type UIMessage } from './useBuildChatRows.test-utils'

describe('buildChatRows repeated compaction timeline', () => {
  it('does not announce an older completion exposed by a later compaction failure', () => {
    const statusAfterFailure = withoutLatestRunningCompaction({
      type: 'compacting',
      reason: 'threshold',
      summaryCountAtStart: 0,
      timeline: [
        {
          id: 'earlier-complete',
          phase: 'completed',
          reason: 'threshold',
          summaryCountAtStart: 0,
          messageCountAtStart: 1,
        },
        {
          id: 'later-running',
          phase: 'running',
          reason: 'threshold',
          summaryCountAtStart: 0,
          messageCountAtStart: 2,
        },
      ],
    })
    const rows = buildChatRows({
      messages: [createUserMessage('user-1', 'continue')],
      isLoading: false,
      error: new Error('Compaction failed'),
      lastUserMessage: 'continue',
      dismissedError: null,
      sessionId: 'session-failed-compaction',
      waggleMetadataLookup: {},
      phase: { current: null, completed: [], totalElapsedMs: 0 },
      compactionStatus: statusAfterFailure,
    })

    expect(rows.find((row) => row.type === 'compaction-status')).toMatchObject({
      id: 'earlier-complete',
      announce: false,
    })
  })

  it('does not resurrect an acknowledged completion when a branch has fewer summaries', () => {
    const status = {
      type: 'completed' as const,
      reason: 'threshold' as const,
      summaryCountAtStart: 0,
      timeline: [
        {
          id: 'first',
          phase: 'completed' as const,
          reason: 'threshold' as const,
          summaryCountAtStart: 0,
          expectedSummaryCount: 1,
          expectedSummaryId: 'durable-first',
          messageCountAtStart: 1,
        },
      ],
    }

    const acknowledged = acknowledgeCompactionStatus(status, ['durable-first'])
    expect(acknowledged).toBeNull()
    expect(acknowledgeCompactionStatus(acknowledged, [])).toBeNull()
  })

  it('keeps a repeated completion until a newer durable summary hydrates', () => {
    const existingSummary: UIMessage = {
      id: 'first-compaction-summary',
      role: 'assistant',
      parts: [{ type: 'text', content: 'Compaction summary\n\nFirst checkpoint.' }],
      metadata: {
        compactionSummary: {
          summary: 'First checkpoint.',
          tokensBefore: 100,
          reason: 'threshold',
        },
      },
    }
    const completedStatus = {
      type: 'completed' as const,
      reason: 'threshold' as const,
      summaryCountAtStart: 1,
      timeline: [
        {
          id: 'second-compaction',
          phase: 'completed' as const,
          reason: 'threshold' as const,
          summaryCountAtStart: 1,
          expectedSummaryId: 'second-compaction-summary',
          messageCountAtStart: 1,
        },
      ],
    }
    const build = (messages: UIMessage[]) =>
      buildChatRows({
        messages,
        isLoading: true,
        error: undefined,
        lastUserMessage: null,
        dismissedError: null,
        sessionId: 'session-repeated-compaction',
        waggleMetadataLookup: {},
        phase: { current: null, completed: [], totalElapsedMs: 0 },
        compactionStatus: completedStatus,
      })

    expect(build([existingSummary]).find((row) => row.type === 'compaction-status')).toEqual({
      type: 'compaction-status',
      id: 'second-compaction',
      anchorMessageCount: 1,
      announce: true,
      state: 'automatic-complete',
    })
    expect(
      build([{ ...existingSummary, id: 'second-compaction-summary' }]).some(
        (row) => row.type === 'compaction-status',
      ),
    ).toBe(false)
  })

  it('anchors repeated completions before later streamed messages', () => {
    const messages: UIMessage[] = [
      createUserMessage('user-1', 'start'),
      {
        id: 'assistant-after-first',
        role: 'assistant',
        parts: [{ type: 'text', content: 'Continued after the first checkpoint.' }],
      },
      createUserMessage('user-2', 'continue again'),
    ]
    const rows = buildChatRows({
      messages,
      isLoading: true,
      error: undefined,
      lastUserMessage: 'continue again',
      dismissedError: null,
      sessionId: 'session-ordered-compactions',
      waggleMetadataLookup: {},
      phase: { current: null, completed: [], totalElapsedMs: 0 },
      compactionStatus: {
        type: 'completed',
        reason: 'threshold',
        summaryCountAtStart: 0,
        timeline: [
          {
            id: 'first',
            phase: 'completed',
            reason: 'threshold',
            summaryCountAtStart: 0,
            expectedSummaryCount: 1,
            expectedSummaryId: 'durable-first',
            messageCountAtStart: 1,
          },
          {
            id: 'second',
            phase: 'completed',
            reason: 'threshold',
            summaryCountAtStart: 0,
            expectedSummaryCount: 2,
            expectedSummaryId: 'durable-second',
            messageCountAtStart: 3,
          },
        ],
      },
    })

    expect(rows.map((row) => (row.type === 'compaction-status' ? row.id : row.type))).toEqual([
      'message',
      'first',
      'message',
      'message',
      'second',
      'phase-indicator',
    ])

    const oneSummary: UIMessage = {
      id: 'durable-first',
      role: 'assistant',
      parts: [{ type: 'text', content: 'First checkpoint' }],
      metadata: {
        compactionSummary: { summary: 'First checkpoint', tokensBefore: 100 },
      },
    }
    const partiallyHydrated = buildChatRows({
      messages: [oneSummary, ...messages],
      isLoading: true,
      error: undefined,
      lastUserMessage: 'continue again',
      dismissedError: null,
      sessionId: 'session-ordered-compactions',
      waggleMetadataLookup: {},
      phase: { current: null, completed: [], totalElapsedMs: 0 },
      compactionStatus: {
        type: 'completed',
        reason: 'threshold',
        summaryCountAtStart: 0,
        timeline: [
          {
            id: 'first',
            phase: 'completed',
            reason: 'threshold',
            summaryCountAtStart: 0,
            expectedSummaryCount: 1,
            expectedSummaryId: 'durable-first',
            messageCountAtStart: 1,
          },
          {
            id: 'second',
            phase: 'completed',
            reason: 'threshold',
            summaryCountAtStart: 0,
            expectedSummaryCount: 2,
            expectedSummaryId: 'durable-second',
            messageCountAtStart: 3,
          },
        ],
      },
    })
    expect(
      partiallyHydrated.filter((row) => row.type === 'compaction-status').map((row) => row.id),
    ).toEqual(['second'])
  })
})
