import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  deferRefresh,
  EARLIER_HISTORY,
  emitUserMessage,
  finishRun1,
  openWorkerMidRun1ThenLeave,
  reopenMidRun2,
  streamRun2,
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
  WORKER_ID,
  workerRunRenderSnapshot,
} from './worker-session-transcript.test-harness'

/*
 * Opening a Worker mid-Run makes its render snapshot route-owned: it then holds the whole transcript,
 * with that Run's answers under their stream ids. When the user leaves and the Run settles, those
 * answers are persisted under Pi entry ids the stream ids never match. A snapshot kept across the
 * next Run's start therefore showed the settled Run's answers twice on reopen, with the persisted
 * copy below the next Run.
 */

const { useBackgroundRunMonitor } = await loadWorkerTranscriptHooks()
const { apiMock, chatStoreMock } = getWorkerTranscriptMocks()

describe('Worker Session transcript after a Run the user watched settles', () => {
  beforeEach(resetWorkerTranscriptState)
  afterEach(cleanupWorkerTranscript)

  it('shows each message once when the Worker went straight on to a queued Follow-up', async () => {
    const monitor = renderHook(() => useBackgroundRunMonitor())
    await settle()
    await openWorkerMidRun1ThenLeave()

    act(() => {
      finishRun1()
      completeRun('run-1', { continues: true })
      streamRun2()
    })
    expect(workerRunRenderSnapshot()).toMatchObject({ seededByRunId: 'run-2' })

    const reopened = await reopenMidRun2()
    reopened.unmount()
    monitor.unmount()
  })

  it('shows each message once when the next Run starts while the settled Run refreshes', async () => {
    const refresh = deferRefresh()
    const monitor = renderHook(() => useBackgroundRunMonitor())
    await settle()
    await openWorkerMidRun1ThenLeave()

    act(() => {
      finishRun1()
      completeRun('run-1')
    })
    expect(chatStoreMock.refreshSession).toHaveBeenCalledWith(WORKER_ID)
    act(() => streamRun2())
    await act(async () => {
      refresh.finish()
      await Promise.resolve()
    })
    expect(workerRunRenderSnapshot()).toMatchObject({ seededByRunId: 'run-2' })

    const reopened = await reopenMidRun2()
    reopened.unmount()
    monitor.unmount()
  })

  it('reseeds a reconnect-announced snapshot when the next Run starts while it refreshes', async () => {
    const refresh = deferRefresh()
    apiMock.getSessionDetail.mockResolvedValue(workerDetail(EARLIER_HISTORY))
    const monitor = renderHook(() => useBackgroundRunMonitor())
    await settle()

    act(() => {
      emit({
        type: 'agent_start',
        runId: `remote-snapshot:${WORKER_ID}`,
        model: String(MODEL),
        timestamp: 10,
      })
      emitUserMessage('live-u1', 'Run 1 prompt', 3, 11)
      emitAssistantText('stream-a1', 'done', 12)
      finishRun1()
      completeRun('run-1')
    })
    act(() => streamRun2())
    await act(async () => {
      refresh.finish()
      await Promise.resolve()
    })
    expect(workerRunRenderSnapshot()).toMatchObject({ seededByRunId: 'run-2' })

    const reopened = await reopenMidRun2()
    reopened.unmount()
    monitor.unmount()
  })
})
