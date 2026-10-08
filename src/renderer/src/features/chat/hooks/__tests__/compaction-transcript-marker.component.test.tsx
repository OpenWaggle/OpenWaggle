// @vitest-environment jsdom

import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  type LogEntry,
  sessionDetailFor,
  sessionWorkspaceFor,
} from './compaction-marker-transcript.fixtures'
import {
  ALL_HISTORY,
  finishManualCompaction,
  HISTORY,
  OTHER_ID,
  OTHER_LOG,
  openSession,
  resetState,
  rowLabel,
  setWorkspace,
  startManualCompaction,
  useBackgroundRunMonitor,
} from './compaction-transcript-marker.test-harness'
import {
  cleanupWorkerTranscript,
  settle,
  WORKER_ID,
} from './worker-session-transcript.test-harness'

/*
 * User report: after a manual `/compact`, the "Context compacted" row disappeared from the
 * transcript once compaction finished, as if it never happened. The Host showed only the model's
 * compacted context, compaction first: the live row was acknowledged by the refetched detail, then
 * the marker reappeared above what the compaction kept, and every message it summarized was gone.
 * The transcript now keeps the whole conversation with the marker where it happened (ADR 0048).
 * These scenarios drive the real chat hook, background monitor and transcript section.
 */

describe('manual compaction marker in the transcript', () => {
  beforeEach(resetState)
  afterEach(cleanupWorkerTranscript)

  it.each<{ readonly name: string; readonly firstKeptEntryId: string }>([
    { name: 'kept the whole conversation', firstKeptEntryId: 'user-1' },
    { name: 'summarized earlier turns', firstKeptEntryId: 'user-2' },
    { name: 'was a Native checkpoint keeping none', firstKeptEntryId: 'native-replacement' },
  ])(
    'keeps the whole conversation above the marker when the compaction $name',
    async (scenario) => {
      const monitor = renderHook(() => useBackgroundRunMonitor())
      const before = sessionDetailFor(WORKER_ID, HISTORY, 1)
      setWorkspace(sessionWorkspaceFor(WORKER_ID, HISTORY, 1))
      const opened = openSession(before)
      await settle()
      expect(opened.result.current.rows.map(rowLabel)).toEqual(ALL_HISTORY)

      startManualCompaction(opened.result.current.chat.messages)
      expect(opened.result.current.rows.map(rowLabel)).toEqual([
        ...ALL_HISTORY,
        'live:manual-running',
      ])

      await finishManualCompaction()
      expect(opened.result.current.rows.map(rowLabel)).toEqual([
        ...ALL_HISTORY,
        'live:manual-complete',
      ])

      const compacted: readonly LogEntry[] = [
        ...HISTORY,
        { id: 'compaction-1', kind: 'compaction', firstKeptEntryId: scenario.firstKeptEntryId },
      ]
      const expected = [...ALL_HISTORY, 'marker:manual']
      // run-completed refetches the detail before the composer's workspace refresh lands.
      const after = sessionDetailFor(WORKER_ID, compacted, 2)
      opened.rerender({ sessionId: WORKER_ID, session: after })
      await settle()
      expect(opened.result.current.rows.map(rowLabel)).toEqual(expected)

      setWorkspace(sessionWorkspaceFor(WORKER_ID, compacted, 2))
      await settle()
      expect(opened.result.current.rows.map(rowLabel)).toEqual(expected)

      // A Session switch: the chat route keeps its hook and hydrates the other Session, then back.
      setWorkspace(sessionWorkspaceFor(OTHER_ID, OTHER_LOG, 1))
      opened.rerender({ sessionId: OTHER_ID, session: sessionDetailFor(OTHER_ID, OTHER_LOG, 1) })
      await settle()
      expect(opened.result.current.rows.map(rowLabel)).toEqual(['other-user', 'other-assistant'])
      setWorkspace(sessionWorkspaceFor(WORKER_ID, compacted, 2))
      opened.rerender({ sessionId: WORKER_ID, session: after })
      await settle()
      expect(opened.result.current.rows.map(rowLabel)).toEqual(expected)

      // Reopening or restarting rebuilds the transcript from the persisted Session only.
      opened.unmount()
      const reopened = openSession(after)
      await settle()
      expect(reopened.result.current.rows.map(rowLabel)).toEqual(expected)

      reopened.unmount()
      monitor.unmount()
    },
  )

  it('keeps every marker of repeated compactions in place', async () => {
    const compacted: readonly LogEntry[] = [
      ...HISTORY,
      { id: 'compaction-1', kind: 'compaction', firstKeptEntryId: 'user-2' },
      { id: 'user-3', kind: 'user' },
      { id: 'assistant-3', kind: 'assistant' },
      { id: 'compaction-2', kind: 'compaction', firstKeptEntryId: 'user-3', reason: 'threshold' },
      { id: 'user-4', kind: 'user' },
    ]
    setWorkspace(sessionWorkspaceFor(WORKER_ID, compacted, 3))
    const opened = openSession(sessionDetailFor(WORKER_ID, compacted, 3))
    await settle()

    expect(opened.result.current.rows.map(rowLabel)).toEqual([
      ...ALL_HISTORY,
      'marker:manual',
      'user-3',
      'assistant-3',
      'marker:threshold',
      'user-4',
    ])
    opened.unmount()
  })
})
