// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { chatRowKeys } from '../../lib/transcript-row-keys'
import { TRANSCRIPT_WINDOW_LIMITS } from '../../lib/transcript-window'
import { useTranscriptWindowRange } from '../useTranscriptWindowRange'
import {
  type LogEntry,
  sessionDetailFor,
  sessionWorkspaceFor,
} from './compaction-marker-transcript.fixtures'
import {
  ALL_HISTORY,
  HISTORY,
  openSession,
  resetState,
  rowLabel,
  setWorkspace,
  useBackgroundRunMonitor,
} from './compaction-transcript-marker.test-harness'
import { emitUserMessage } from './worker-session-settled-run.fixtures'
import {
  cleanupWorkerTranscript,
  completeRun,
  emit,
  emitAssistantText,
  getWorkerTranscriptMocks,
  MODEL,
  settle,
  WORKER_ID,
} from './worker-session-transcript.test-harness'

/*
 * ADR 0048 for automatic compactions and long Sessions: the marker of a compaction during a Run
 * stays between that Run's prompt and its answer, and a Session compacted many times shows its whole
 * history behind the bounded transcript window.
 */

const { apiMock } = getWorkerTranscriptMocks()

/** A long Session compacted every 500 entries, each compaction keeping its last 40. */
function longCompactedLog(entryCount: number): LogEntry[] {
  return Array.from({ length: entryCount }, (_, index): LogEntry => {
    if (index > 0 && index % 500 === 0) {
      return {
        id: `compaction-${String(index)}`,
        kind: 'compaction',
        firstKeptEntryId: `entry-${String(index - 40)}`,
        reason: 'threshold',
      }
    }
    return { id: `entry-${String(index)}`, kind: index % 2 === 0 ? 'user' : 'assistant' }
  })
}

describe('long compacted Session', () => {
  beforeEach(resetState)
  afterEach(cleanupWorkerTranscript)

  it('shows its whole history behind the bounded transcript window', async () => {
    const log = longCompactedLog(6_000)
    setWorkspace(sessionWorkspaceFor(WORKER_ID, log, 2))
    const opened = openSession(sessionDetailFor(WORKER_ID, log, 2))
    await settle()
    const rows = opened.result.current.rows
    const keys = chatRowKeys(rows)
    expect(rows).toHaveLength(6_000)
    expect(rows.filter((row) => row.type === 'compaction-summary')).toHaveLength(11)
    expect(new Set(keys).size).toBe(keys.length)

    const window = renderHook(() =>
      useTranscriptWindowRange({
        rows,
        keys,
        anchorKey: null,
        isFollowing: () => true,
        boundsLikeFollower: false,
      }),
    )
    // Only the newest rows mount; older history loads as the reader scrolls up (ADR 0036).
    expect(window.result.current.end - window.result.current.start).toBe(
      TRANSCRIPT_WINDOW_LIMITS.initialRows,
    )
    expect(window.result.current.hasEarlier).toBe(true)
    window.unmount()
    opened.unmount()
  })
})

describe('automatic compaction marker in the transcript', () => {
  beforeEach(resetState)
  afterEach(cleanupWorkerTranscript)

  it('keeps a threshold compaction during a Run between its prompt and its answer', async () => {
    const monitor = renderHook(() => useBackgroundRunMonitor())
    const before = sessionDetailFor(WORKER_ID, HISTORY, 1)
    apiMock.getSessionDetail.mockResolvedValue(before)
    setWorkspace(sessionWorkspaceFor(WORKER_ID, HISTORY, 1))
    const opened = openSession(before)
    await settle()

    act(() => {
      emit({ type: 'agent_start', runId: 'run-1', model: String(MODEL), timestamp: 30 })
      emitUserMessage('live-user-3', 'user-3', 4, 31)
      emit({ type: 'compaction_start', reason: 'threshold', timestamp: 32 })
      emit({
        type: 'compaction_end',
        reason: 'threshold',
        result: { entryId: 'compaction-1' },
        aborted: false,
        willRetry: false,
        timestamp: 33,
      })
      emitAssistantText('stream-assistant-3', 'assistant-3', 34)
      emit({
        type: 'message_end',
        messageId: 'stream-assistant-3',
        role: 'assistant',
        timestamp: 36,
      })
      emit({ type: 'agent_end', runId: 'run-1', reason: 'stop', timestamp: 37 })
    })
    await settle()
    expect(opened.result.current.rows.map(rowLabel)).toEqual([
      ...ALL_HISTORY,
      'user-3',
      'live:automatic-complete',
      'assistant-3',
      // The Run has not settled yet.
      'phase-indicator',
    ])

    const compacted: readonly LogEntry[] = [
      ...HISTORY,
      { id: 'user-3', kind: 'user' },
      { id: 'compaction-1', kind: 'compaction', firstKeptEntryId: 'user-2', reason: 'threshold' },
      { id: 'assistant-3', kind: 'assistant' },
    ]
    const after = sessionDetailFor(WORKER_ID, compacted, 2)
    apiMock.getSessionDetail.mockResolvedValue(after)
    act(() => completeRun('run-1'))
    opened.rerender({ sessionId: WORKER_ID, session: after })
    setWorkspace(sessionWorkspaceFor(WORKER_ID, compacted, 2))
    await settle()
    const expected = [...ALL_HISTORY, 'user-3', 'marker:threshold', 'assistant-3']
    expect(opened.result.current.rows.map(rowLabel)).toEqual(expected)

    opened.unmount()
    const reopened = openSession(after)
    await settle()
    expect(reopened.result.current.rows.map(rowLabel)).toEqual(expected)

    reopened.unmount()
    monitor.unmount()
  })
})
