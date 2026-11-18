import { SessionId, SupportedModelId } from '@shared/types/brand'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useSessionStore } from '@/features/sessions/state/session-store'
import { useSessionStatusMonitor } from '../useSessionStatusMonitor'

const monitorMocks = vi.hoisted(() => ({
  listActiveRuns: vi.fn(),
  listSessionsByIds: vi.fn(),
  querySessionControl: vi.fn(),
}))

vi.mock('@/shared/lib/ipc', async () => ({
  api: (await import('@/test-utils/preload-api')).preloadApi(monitorMocks),
}))

describe('useSessionStatusMonitor running Worker parents', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useSessionStore.setState({ sessions: [] })
    monitorMocks.listSessionsByIds.mockResolvedValue([])
    monitorMocks.querySessionControl.mockImplementation(async (request) => ({
      contractVersion: 2,
      requestId: request.requestId,
      outcome: {
        operation: 'requests-list' as const,
        sessionId: request.query.sessionId,
        requests: [],
      },
    }))
  })

  it('reads running Workers one batch at a time and stops between batches once unmounted', async () => {
    const runs = Array.from({ length: 201 }, (_value, index) => ({
      activity: 'agent-run' as const,
      sessionId: SessionId(`worker-${String(index)}`),
      model: SupportedModelId('openai/gpt-5'),
      mode: 'classic' as const,
      startedAt: index + 1,
      activityEvents: [],
    }))
    monitorMocks.listActiveRuns.mockResolvedValue(runs)
    let finishFirstBatch: () => void = () => undefined
    monitorMocks.listSessionsByIds.mockImplementationOnce(
      () =>
        new Promise<never[]>((resolve) => {
          finishFirstBatch = () => resolve([])
        }),
    )

    const monitor = renderHook(() => useSessionStatusMonitor())
    await waitFor(() => expect(monitorMocks.listSessionsByIds).toHaveBeenCalledTimes(1))
    // The Host reads these on one SQLite connection: the second batch waits for the first.
    await act(async () => {
      await Promise.resolve()
    })
    expect(monitorMocks.listSessionsByIds).toHaveBeenCalledTimes(1)

    monitor.unmount()
    await act(async () => {
      finishFirstBatch()
      await Promise.resolve()
    })
    expect(monitorMocks.listSessionsByIds).toHaveBeenCalledTimes(1)
  })
})
