import type { UpdateStatus } from '@shared/types/updater'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useUIStore } from '../ui-store'
import { useAutoUpdater } from '../useAutoUpdater'

const mocks = vi.hoisted(() => {
  const listener: { current: ((status: UpdateStatus) => void) | null } = { current: null }
  return {
    installUpdate: vi.fn<() => Promise<void>>(),
    listener,
    unsubscribe: vi.fn(),
  }
})

vi.mock('@/shared/lib/ipc', () => ({
  api: {
    installUpdate: mocks.installUpdate,
    onUpdateStatus: (listener: (status: UpdateStatus) => void) => {
      mocks.listener.current = listener
      return mocks.unsubscribe
    },
  },
}))

beforeEach(() => {
  useUIStore.getState().clearToast()
  mocks.installUpdate.mockReset().mockResolvedValue(undefined)
  mocks.listener.current = null
  mocks.unsubscribe.mockReset()
})

describe('auto-updater notification', () => {
  it('clears an invalidated download and can announce its replacement', () => {
    renderHook(useAutoUpdater)

    act(() => mocks.listener.current?.({ type: 'downloaded', version: '0.5.0-alpha.1' }))
    expect(useUIStore.getState().toastData?.message).toBe('Update v0.5.0-alpha.1 ready')

    act(() => mocks.listener.current?.({ type: 'not-available' }))
    expect(useUIStore.getState().toastData).toBeNull()

    act(() => mocks.listener.current?.({ type: 'downloaded', version: '0.4.1' }))
    expect(useUIStore.getState().toastData?.message).toBe('Update v0.4.1 ready')
  })

  it('does not clear a newer toast owned by another feature', () => {
    renderHook(useAutoUpdater)
    act(() => mocks.listener.current?.({ type: 'downloaded', version: '0.4.1' }))
    act(() =>
      useUIStore.getState().showPersistentToast({ message: 'Other alert', persistent: true }),
    )

    act(() => mocks.listener.current?.({ type: 'idle' }))

    expect(useUIStore.getState().toastData?.message).toBe('Other alert')
  })
})
