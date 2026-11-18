import type { TerminalActivitySnapshot } from '@shared/types/terminal'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getTerminalActivityStatus,
  useTerminalActivityStore,
} from '../../state/terminal-activity-store'
import { useTerminalStore } from '../../state/terminal-store'
import { useTerminalActivityMonitor } from '../useTerminalActivityMonitor'

const mocks = vi.hoisted(() => {
  let listener: ((snapshot: TerminalActivitySnapshot) => void) | null = null
  let resolveInitial: (snapshot: TerminalActivitySnapshot) => void = () => undefined
  return {
    getTerminalActivitySnapshot: vi.fn(
      () =>
        new Promise<TerminalActivitySnapshot>((resolve) => {
          resolveInitial = resolve
        }),
    ),
    onTerminalActivitySnapshot: vi.fn((next: (snapshot: TerminalActivitySnapshot) => void) => {
      listener = next
      return mocks.unsubscribe
    }),
    unsubscribe: vi.fn(),
    emit(snapshot: TerminalActivitySnapshot) {
      listener?.(snapshot)
    },
    resolveInitial(snapshot: TerminalActivitySnapshot) {
      resolveInitial(snapshot)
    },
  }
})

vi.mock('@/shared/lib/ipc', () => ({
  api: {
    getTerminalActivitySnapshot: mocks.getTerminalActivitySnapshot,
    onTerminalActivitySnapshot: mocks.onTerminalActivitySnapshot,
  },
}))

describe('useTerminalActivityMonitor', () => {
  beforeEach(() => {
    useTerminalActivityStore.getState().reset()
    useTerminalStore.setState({ groups: {}, activity: {}, portPreviews: {}, exits: {} })
    mocks.getTerminalActivitySnapshot.mockClear()
    mocks.onTerminalActivitySnapshot.mockClear()
    mocks.unsubscribe.mockClear()
  })

  it('subscribes before loading and rejects an out-of-order initial snapshot', async () => {
    const { unmount } = renderHook(() => useTerminalActivityMonitor())

    expect(mocks.onTerminalActivitySnapshot).toHaveBeenCalledOnce()
    expect(mocks.getTerminalActivitySnapshot).toHaveBeenCalledOnce()
    act(() => {
      mocks.emit({
        revision: 2,
        summaries: [
          {
            ownerKey: 'session-1',
            terminalId: 'main',
            activityStatus: 'running',
            processName: 'pnpm',
            ports: [5173],
            portPreviews: [{ host: '127.0.0.1', port: 5173, url: 'http://127.0.0.1:5173/' }],
            projectActionPending: false,
          },
        ],
        truncated: false,
      })
      mocks.resolveInitial({
        revision: 1,
        summaries: [
          {
            ownerKey: 'session-1',
            terminalId: 'main',
            activityStatus: 'idle',
            processName: null,
            ports: [],
            projectActionPending: false,
          },
        ],
        truncated: false,
      })
    })

    await waitFor(() => expect(getTerminalActivityStatus('session-1', 'main')).toBe('running'))
    expect(useTerminalStore.getState()).toMatchObject({
      activity: { 'session-1::main': 'pnpm' },
      portPreviews: {
        'session-1::main': [{ host: '127.0.0.1', port: 5173, url: 'http://127.0.0.1:5173/' }],
      },
    })
    unmount()
    expect(mocks.unsubscribe).toHaveBeenCalledOnce()
  })
})
