import type { SessionDetail } from '@shared/types/session'
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  EARLIER_HISTORY,
  emitUserMessage,
  expectUniqueIds,
  finishRun1,
  openWorkerMidRun1,
  RUN_1_PERSISTED,
  workerDetail,
} from './worker-session-settled-run.fixtures'
import {
  cleanupWorkerTranscript,
  completeRun,
  emit,
  emitAssistantText,
  getWorkerTranscriptMocks,
  loadWorkerTranscriptHooks,
  MODEL,
  resetWorkerTranscriptState,
  settle,
  transcriptText,
  WORKER_ID,
} from './worker-session-transcript.test-harness'

/*
 * A threshold compaction can run between a Run's settlement and the queued Follow-up's start: right
 * after `agent_end`, or after the settlement and before the Follow-up is prompted. It marks the
 * Session active, so a hydration then (opening the Worker, or a refresh of the open one) used to
 * take the settled Run's rows for the active Run's and show them after their persisted copies.
 */

const { useAgentChat, useBackgroundRunMonitor } = await loadWorkerTranscriptHooks()
const { apiMock } = getWorkerTranscriptMocks()

const SETTLED_TRANSCRIPT = [
  ['user', 'Earlier prompt'],
  ['assistant', 'Earlier answer'],
  ['user', 'Run 1 prompt'],
  ['assistant', 'done R1'],
]

const PERSISTED = workerDetail([...EARLIER_HISTORY, ...RUN_1_PERSISTED], 2)

type CompactionOrder = 'before-settlement' | 'after-settlement'

function settleRun1WithCompaction(order: CompactionOrder) {
  const compact = () => emit({ type: 'compaction_start', reason: 'threshold', timestamp: 17 })
  act(() => {
    finishRun1()
    if (order === 'before-settlement') compact()
    completeRun('run-1', { continues: true })
    if (order === 'after-settlement') compact()
  })
}

function runRun1Hidden() {
  apiMock.getSessionDetail.mockResolvedValue(workerDetail(EARLIER_HISTORY))
  act(() => {
    emit({ type: 'agent_start', runId: 'run-1', model: String(MODEL), timestamp: 10 })
    emitUserMessage('live-u1', 'Run 1 prompt', 3, 11)
    emitAssistantText('stream-a1', 'done', 12)
  })
}

async function expectSettledTranscriptOnce(messages: () => ReturnType<typeof useAgentChat>) {
  await waitFor(() => {
    expect(apiMock.getBackgroundRun).toHaveBeenLastCalledWith(WORKER_ID)
    expect(transcriptText(messages().messages)).toEqual(SETTLED_TRANSCRIPT)
  })
  await settle()
  expect(transcriptText(messages().messages)).toEqual(SETTLED_TRANSCRIPT)
  expectUniqueIds(messages().messages)
  // The compaction started after Run 1, below its persisted copy.
  expect(messages().compactionStatus).toMatchObject({
    timeline: [{ messageCountAtStart: SETTLED_TRANSCRIPT.length }],
  })
}

describe.each<CompactionOrder>(['before-settlement', 'after-settlement'])(
  'Worker Session transcript during a compaction %s of its Run',
  (order) => {
    beforeEach(resetWorkerTranscriptState)
    afterEach(cleanupWorkerTranscript)

    it('shows the settled Run once when the hidden Worker is opened during the compaction', async () => {
      const monitor = renderHook(() => useBackgroundRunMonitor())
      await settle()
      runRun1Hidden()
      settleRun1WithCompaction(order)

      apiMock.getSessionDetail.mockResolvedValue(PERSISTED)
      apiMock.getBackgroundRun.mockResolvedValue(null)
      const opened = renderHook(() => useAgentChat(WORKER_ID, PERSISTED, MODEL))
      await expectSettledTranscriptOnce(() => opened.result.current)

      opened.unmount()
      monitor.unmount()
    })

    it('shows the settled Run once when the open Worker refreshes during the compaction', async () => {
      const monitor = renderHook(() => useBackgroundRunMonitor())
      await settle()
      const opened = await openWorkerMidRun1()
      settleRun1WithCompaction(order)

      apiMock.getSessionDetail.mockResolvedValue(PERSISTED)
      apiMock.getBackgroundRun.mockResolvedValue(null)
      opened.rerender({ session: PERSISTED satisfies SessionDetail })
      await expectSettledTranscriptOnce(() => opened.result.current)

      opened.unmount()
      monitor.unmount()
    })
  },
)
