import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  EARLIER_HISTORY,
  EXPECTED_TRANSCRIPT,
  expectUniqueIds,
  finishRun1,
  openWorkerMidRun1,
  RUN_1_PERSISTED,
  RUN_2_BUFFER,
  reopenMidRun2,
  streamRun2,
  workerDetail,
} from './worker-session-settled-run.fixtures'
import {
  cleanupWorkerTranscript,
  completeRun,
  getWorkerTranscriptMocks,
  loadWorkerTranscriptHooks,
  MODEL,
  resetWorkerTranscriptState,
  settle,
  transcriptText,
  WORKER_ID,
} from './worker-session-transcript.test-harness'

/*
 * A Worker the user keeps open while it goes straight on to a queued Follow-up: its route still
 * shows the settled Run under stream ids, and its writes during the next Run replace the settled
 * mark on the render snapshot. The settled Run was then shown twice once its persisted copy
 * arrived, on reopen or when a refresh landed during the next Run.
 */

const { useAgentChat, useBackgroundRunMonitor } = await loadWorkerTranscriptHooks()
const { apiMock } = getWorkerTranscriptMocks()

/** The open Worker settles Run 1 and goes straight on to Run 2. */
function continueIntoRun2() {
  act(() => {
    finishRun1()
    completeRun('run-1', { continues: true })
    streamRun2()
  })
}

describe('Worker Session transcript watched through a queued Follow-up hand-off', () => {
  beforeEach(resetWorkerTranscriptState)
  afterEach(cleanupWorkerTranscript)

  it('shows each message once when the user leaves during the next Run and reopens', async () => {
    const monitor = renderHook(() => useBackgroundRunMonitor())
    await settle()
    const opened = await openWorkerMidRun1()

    continueIntoRun2()
    await waitFor(() => {
      expect(transcriptText(opened.result.current.messages)).toEqual(EXPECTED_TRANSCRIPT)
    })
    opened.unmount()

    const reopened = await reopenMidRun2()
    reopened.unmount()
    monitor.unmount()
  })

  it('shows each message once when the settled Run refresh lands during the next Run', async () => {
    const monitor = renderHook(() => useBackgroundRunMonitor())
    await settle()
    const opened = await openWorkerMidRun1()
    continueIntoRun2()

    const persisted = workerDetail([...EARLIER_HISTORY, ...RUN_1_PERSISTED], 2)
    apiMock.getSessionDetail.mockResolvedValue(persisted)
    apiMock.getBackgroundRun.mockResolvedValue(RUN_2_BUFFER)
    opened.rerender({ session: persisted })

    await waitFor(() => {
      expect(apiMock.getBackgroundRun).toHaveBeenLastCalledWith(workerDetail(EARLIER_HISTORY).id)
      expect(transcriptText(opened.result.current.messages)).toEqual(EXPECTED_TRANSCRIPT)
      expect(opened.result.current.messages.map((message) => message.id)).toContain('n-a1')
    })
    await settle()
    expect(transcriptText(opened.result.current.messages)).toEqual(EXPECTED_TRANSCRIPT)
    expectUniqueIds(opened.result.current.messages)

    opened.unmount()
    monitor.unmount()
  })

  it('shows each message once when the Worker reopens with a stale transcript', async () => {
    const monitor = renderHook(() => useBackgroundRunMonitor())
    await settle()
    const opened = await openWorkerMidRun1()
    continueIntoRun2()
    opened.unmount()

    // The chat store still holds the transcript from before Run 1; the Host already persisted it.
    const persisted = workerDetail([...EARLIER_HISTORY, ...RUN_1_PERSISTED], 2)
    apiMock.getSessionDetail.mockResolvedValue(persisted)
    apiMock.getBackgroundRun.mockResolvedValue(RUN_2_BUFFER)
    const reopened = renderHook(() => useAgentChat(WORKER_ID, workerDetail(EARLIER_HISTORY), MODEL))

    await waitFor(() => {
      expect(apiMock.getBackgroundRun).toHaveBeenLastCalledWith(WORKER_ID)
      expect(reopened.result.current.messages.map((message) => message.id)).toContain('n-a1')
    })
    await settle()
    expect(transcriptText(reopened.result.current.messages)).toEqual(EXPECTED_TRANSCRIPT)
    expectUniqueIds(reopened.result.current.messages)

    reopened.unmount()
    monitor.unmount()
  })
})
