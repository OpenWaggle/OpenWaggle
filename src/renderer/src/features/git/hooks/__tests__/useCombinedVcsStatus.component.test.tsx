import { WorkingPath } from '@shared/types/brand'
import type { LocalVcsStatus, RemoteVcsStatus } from '@shared/types/git'
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useCombinedVcsStatus } from '../useCombinedVcsStatus'

const getLocalVcsStatus = vi.hoisted(() => vi.fn())
const getRemoteVcsStatus = vi.hoisted(() => vi.fn())

vi.mock('@/shared/lib/ipc', () => ({ api: { getLocalVcsStatus, getRemoteVcsStatus } }))

const LOCAL_STATUS: LocalVcsStatus = {
  isRepo: true,
  sourceControlProvider: { id: 'github', host: 'github.com' },
  hasPrimaryRemote: true,
  defaultRef: 'main',
  isDefaultRef: true,
  refName: 'main',
  pushTargetRef: 'main',
  pushTargetIsDefaultRef: true,
  hasWorkingTreeChanges: true,
  workingTree: { files: [], insertions: 0, deletions: 0 },
}

const REMOTE_STATUS: RemoteVcsStatus = {
  hasUpstream: true,
  aheadCount: 0,
  behindCount: 0,
  aheadOfDefaultCount: null,
  changeRequest: null,
}

describe('useCombinedVcsStatus', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    getLocalVcsStatus.mockReset()
    getRemoteVcsStatus.mockReset().mockResolvedValue({ ok: true, status: REMOTE_STATUS })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('recovers automatically from a transient local status failure', async () => {
    getLocalVcsStatus
      .mockResolvedValueOnce({
        ok: false,
        code: 'not-a-repo',
        message: 'Git was temporarily unavailable.',
      })
      .mockResolvedValueOnce({
        ok: false,
        code: 'not-a-repo',
        message: 'Git was temporarily unavailable.',
      })
      .mockResolvedValueOnce({
        ok: false,
        code: 'not-a-repo',
        message: 'Git was temporarily unavailable.',
      })
      .mockResolvedValueOnce({
        ok: false,
        code: 'not-a-repo',
        message: 'Git was temporarily unavailable.',
      })
      .mockResolvedValueOnce({ ok: true, status: LOCAL_STATUS })

    const { result } = renderHook(() => useCombinedVcsStatus(WorkingPath('/project')))

    await act(async () => {
      await vi.runAllTimersAsync()
    })

    expect(getLocalVcsStatus).toHaveBeenCalledTimes(5)
    expect(getRemoteVcsStatus).toHaveBeenCalledOnce()
    expect(result.current.status).toEqual({ ...LOCAL_STATUS, ...REMOTE_STATUS })
  })

  it('stops retrying after the bounded local retry budget is exhausted', async () => {
    getLocalVcsStatus.mockResolvedValue({
      ok: false,
      code: 'unknown',
      message: 'Git is unavailable.',
    })

    const { result } = renderHook(() => useCombinedVcsStatus(WorkingPath('/project')))

    await act(async () => {
      await vi.runAllTimersAsync()
    })

    expect(getLocalVcsStatus).toHaveBeenCalledTimes(5)
    expect(getRemoteVcsStatus).not.toHaveBeenCalled()
    expect(result.current.status).toBeNull()
  })

  it('cancels an old path retry when the opened session changes', async () => {
    getLocalVcsStatus.mockImplementation(async (workingPath: string) =>
      workingPath === '/project-a'
        ? { ok: false, code: 'unknown', message: 'Git is unavailable.' }
        : { ok: true, status: LOCAL_STATUS },
    )
    const { result, rerender } = renderHook(
      ({ workingPath }: { readonly workingPath: string }) =>
        useCombinedVcsStatus(WorkingPath(workingPath)),
      { initialProps: { workingPath: '/project-a' } },
    )

    await act(async () => {
      await Promise.resolve()
    })
    rerender({ workingPath: '/project-b' })
    await act(async () => {
      await vi.runAllTimersAsync()
    })

    expect(getLocalVcsStatus.mock.calls.map(([workingPath]) => workingPath)).toEqual([
      '/project-a',
      '/project-b',
    ])
    expect(getRemoteVcsStatus).toHaveBeenCalledOnce()
    expect(getRemoteVcsStatus).toHaveBeenCalledWith(WorkingPath('/project-b'))
    expect(result.current.status).toEqual({ ...LOCAL_STATUS, ...REMOTE_STATUS })
  })
})
