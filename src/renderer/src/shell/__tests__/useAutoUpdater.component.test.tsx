import type { UpdateStatus } from '@shared/types/updater'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useUIStore } from '../ui-store'
import { useAutoUpdater } from '../useAutoUpdater'

const mocks = vi.hoisted(() => {
  const listener: { current: ((status: UpdateStatus) => void) | null } = { current: null }
  return {
    installUpdate: vi.fn<() => Promise<void>>(),
    installUpdateNow: vi.fn<() => Promise<void>>(),
    listener,
    unsubscribe: vi.fn(),
  }
})

vi.mock('@/shared/lib/ipc', () => ({
  api: {
    installUpdate: mocks.installUpdate,
    installUpdateNow: mocks.installUpdateNow,
    onUpdateStatus: (listener: (status: UpdateStatus) => void) => {
      mocks.listener.current = listener
      return mocks.unsubscribe
    },
  },
}))

beforeEach(() => {
  useUIStore.getState().clearToast()
  mocks.installUpdate.mockReset().mockResolvedValue(undefined)
  mocks.installUpdateNow.mockReset().mockResolvedValue(undefined)
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

  it('shows how many runs Restart when idle waits for and offers Restart now', () => {
    renderHook(useAutoUpdater)
    act(() => mocks.listener.current?.({ type: 'downloaded', version: '1.0.0' }))
    act(() => useUIStore.getState().toastData?.action?.onClick?.())
    expect(mocks.installUpdate).toHaveBeenCalledOnce()

    act(() => mocks.listener.current?.({ type: 'downloaded', version: '1.0.0', waitingForRuns: 2 }))
    const waiting = useUIStore.getState().toastData
    expect(waiting?.message).toBe('Update v1.0.0 will install when 2 agent runs finish')
    expect(waiting?.action?.label).toBe('Restart now')
    act(() => waiting?.action?.onClick?.())
    expect(mocks.installUpdateNow).toHaveBeenCalledOnce()

    act(() => mocks.listener.current?.({ type: 'downloaded', version: '1.0.0', waitingForRuns: 1 }))
    expect(useUIStore.getState().toastData?.message).toBe(
      'Update v1.0.0 will install when 1 agent run finishes',
    )
  })

  it('replaces Restart to update with a progress notice once the restart begins', () => {
    renderHook(useAutoUpdater)
    act(() => mocks.listener.current?.({ type: 'downloaded', version: '1.0.0' }))

    act(() => mocks.listener.current?.({ type: 'installing', version: '1.0.0' }))

    const toast = useUIStore.getState().toastData
    expect(toast?.message).toMatch(
      /^Installing update v1\.0\.0\. .* will reopen when it is done\.$/,
    )
    expect(toast?.action).toBeUndefined()
    expect(toast?.persistent).toBe(true)

    act(() => mocks.listener.current?.({ type: 'error', message: 'signature mismatch' }))
    expect(useUIStore.getState().toastData).toBeNull()
  })

  it('says why the last restart did not install and lets the user try again', () => {
    renderHook(useAutoUpdater)

    act(() =>
      mocks.listener.current?.({
        type: 'downloaded',
        version: '1.0.0',
        installFailure: 'Version 1.0.0 did not finish installing. Restart to update to try again.',
      }),
    )

    const toast = useUIStore.getState().toastData
    expect(toast?.message).toBe(
      'Version 1.0.0 did not finish installing. Restart to update to try again.',
    )
    expect(toast?.variant).toBe('error')
    act(() => toast?.action?.onClick?.())
    expect(mocks.installUpdate).toHaveBeenCalledOnce()
  })
})
