import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useUIStore } from '../ui-store'
import { useDesktopNativeAdmissionNotice } from '../useDesktopNativeAdmissionNotice'

const mocks = vi.hoisted(() => ({ getIssue: vi.fn<() => Promise<string | null>>() }))
vi.mock('@/shared/lib/ipc', () => ({ api: { getDesktopNativeAdmissionIssue: mocks.getIssue } }))

beforeEach(() => {
  useUIStore.getState().clearToast()
  mocks.getIssue.mockReset().mockResolvedValue(null)
})

describe('desktop ownership quarantine notice', () => {
  it('leaves a healthy workspace unchanged', async () => {
    renderHook(useDesktopNativeAdmissionNotice)
    await waitFor(() => expect(mocks.getIssue).toHaveBeenCalledOnce())
    expect(useUIStore.getState().toastData).toBeNull()
  })

  it('uses the existing persistent error toast without blocking session navigation', async () => {
    const message = 'Sessions remain available. Previous desktop native cleanup is uncertain.'
    mocks.getIssue.mockResolvedValue(message)
    renderHook(useDesktopNativeAdmissionNotice)
    await waitFor(() =>
      expect(useUIStore.getState().toastData).toEqual({
        message,
        persistent: true,
        variant: 'error',
      }),
    )
    act(() => useUIStore.getState().clearToast())
    expect(useUIStore.getState().toastData).toBeNull()
    expect(useUIStore.getState().activeView).toBe('chat')
  })

  it('does not publish an obsolete result after unmount', async () => {
    const result = Promise.withResolvers<string | null>()
    mocks.getIssue.mockReturnValue(result.promise)
    const { unmount } = renderHook(useDesktopNativeAdmissionNotice)
    unmount()
    await act(async () => {
      result.resolve('Obsolete issue')
      await result.promise
    })
    expect(useUIStore.getState().toastData).toBeNull()
  })

  it('reports an unreadable status using a safe persistent message', async () => {
    mocks.getIssue.mockRejectedValue(new Error('credential=do-not-display'))
    renderHook(useDesktopNativeAdmissionNotice)
    await waitFor(() =>
      expect(useUIStore.getState().toastData).toMatchObject({ persistent: true, variant: 'error' }),
    )
    expect(useUIStore.getState().toastData?.message).toContain(
      'Could not read desktop ownership status',
    )
    expect(useUIStore.getState().toastData?.message).not.toContain('credential')
  })
})
