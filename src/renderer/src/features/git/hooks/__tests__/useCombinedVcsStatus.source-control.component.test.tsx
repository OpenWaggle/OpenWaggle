import { WorkingPath } from '@shared/types/brand'
import type { LocalVcsStatus, RemoteVcsStatus } from '@shared/types/git'
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { invalidateVcsStatus } from '../../lib/vcs-status-invalidation'
import { useCombinedVcsStatus } from '../useCombinedVcsStatus'

const getLocalVcsStatus = vi.hoisted(() => vi.fn())
const getRemoteVcsStatus = vi.hoisted(() => vi.fn())

vi.mock('@/shared/lib/ipc', () => ({
  api: { getLocalVcsStatus, getRemoteVcsStatus },
}))

const LOCAL_STATUS: LocalVcsStatus = {
  isRepo: true,
  sourceControlProvider: { id: 'github', host: 'github.com' },
  sourceControlHost: { host: 'github.com', provider: 'github', source: 'public-host' },
  sourceControlAttention: null,
  sourceControlRepositoryUrl: null,
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
  changeRequestAttention: null,
  changeRequestAccount: null,
}

describe('useCombinedVcsStatus source control', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    getLocalVcsStatus.mockReset()
    getRemoteVcsStatus.mockReset().mockResolvedValue({ ok: true, status: REMOTE_STATUS })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('keeps the local Source control host while the remote half is missing', async () => {
    getLocalVcsStatus.mockResolvedValue({ ok: true, status: LOCAL_STATUS })
    getRemoteVcsStatus.mockResolvedValue({ ok: false, code: 'unknown', message: 'Offline.' })

    const { result } = renderHook(() => useCombinedVcsStatus(WorkingPath('/project')))
    await act(async () => {
      await vi.runAllTimersAsync()
    })

    expect(result.current.remoteState).toBe('error')
    expect(result.current.status?.sourceControlProvider).toEqual(LOCAL_STATUS.sourceControlProvider)
    expect(result.current.status?.sourceControlHost).toEqual(LOCAL_STATUS.sourceControlHost)
    expect(result.current.status?.changeRequestAttention).toBeNull()
  })

  it('keeps the local provider when the remote probe did not decide one', async () => {
    getLocalVcsStatus.mockResolvedValue({ ok: true, status: LOCAL_STATUS })

    const { result } = renderHook(() => useCombinedVcsStatus(WorkingPath('/project')))
    await act(async () => {
      await vi.runAllTimersAsync()
    })

    expect(result.current.status?.sourceControlProvider).toEqual(LOCAL_STATUS.sourceControlProvider)
  })

  it('lets a provider decided by the remote probe win over the offline answer', async () => {
    getLocalVcsStatus.mockResolvedValue({
      ok: true,
      status: {
        ...LOCAL_STATUS,
        sourceControlProvider: null,
        sourceControlHost: { host: 'git.corp.example', provider: null, source: null },
        sourceControlAttention: { kind: 'choose-provider', host: 'git.corp.example' },
      },
    })
    getRemoteVcsStatus.mockResolvedValue({
      ok: true,
      status: {
        ...REMOTE_STATUS,
        sourceControlProvider: { id: 'gitlab', host: 'git.corp.example' },
        sourceControlHost: { host: 'git.corp.example', provider: 'gitlab', source: 'remote-refs' },
      },
    })

    const { result } = renderHook(() => useCombinedVcsStatus(WorkingPath('/project')))
    await act(async () => {
      await vi.runAllTimersAsync()
    })

    expect(result.current.status?.sourceControlProvider).toEqual({
      id: 'gitlab',
      host: 'git.corp.example',
    })
    expect(result.current.status?.sourceControlHost?.source).toBe('remote-refs')
  })

  it('prefers a provider the offline answer now has over a stale remote one', async () => {
    const corpHost = 'git.corp.example'
    getLocalVcsStatus.mockResolvedValueOnce({
      ok: true,
      status: {
        ...LOCAL_STATUS,
        sourceControlProvider: null,
        sourceControlHost: { host: corpHost, provider: null, source: null },
      },
    })
    getRemoteVcsStatus.mockResolvedValueOnce({
      ok: true,
      status: {
        ...REMOTE_STATUS,
        sourceControlProvider: { id: 'gitlab', host: corpHost },
        sourceControlHost: { host: corpHost, provider: 'gitlab', source: 'remote-refs' },
      },
    })
    const { result } = renderHook(() => useCombinedVcsStatus(WorkingPath('/project')))
    await act(async () => {
      await vi.runAllTimersAsync()
    })
    expect(result.current.status?.sourceControlProvider?.id).toBe('gitlab')

    // The user chose GitHub; the remote revalidation fails, so the stale remote half is kept.
    getLocalVcsStatus.mockResolvedValueOnce({
      ok: true,
      status: {
        ...LOCAL_STATUS,
        sourceControlProvider: { id: 'github', host: corpHost },
        sourceControlHost: { host: corpHost, provider: 'github', source: 'user-choice' },
      },
    })
    getRemoteVcsStatus.mockResolvedValueOnce({ ok: false, code: 'unknown', message: 'Offline.' })
    await act(async () => {
      await result.current.refresh()
    })

    expect(result.current.remote?.sourceControlProvider?.id).toBe('gitlab')
    expect(result.current.status?.sourceControlProvider?.id).toBe('github')
    expect(result.current.status?.sourceControlHost?.source).toBe('user-choice')
  })

  it('re-reads every consumer of one working tree when its status is invalidated', async () => {
    getLocalVcsStatus.mockResolvedValue({ ok: true, status: LOCAL_STATUS })
    renderHook(() => useCombinedVcsStatus(WorkingPath('/project')))
    renderHook(() => useCombinedVcsStatus(WorkingPath('/project')))
    renderHook(() => useCombinedVcsStatus(WorkingPath('/other')))
    await act(async () => {
      await vi.runAllTimersAsync()
    })
    const reads = (path: string) =>
      getLocalVcsStatus.mock.calls.filter(([candidate]) => candidate === path).length
    expect(reads('/project')).toBe(2)

    await act(async () => {
      await invalidateVcsStatus(WorkingPath('/project'))
    })

    expect(reads('/project')).toBe(4)
    expect(reads('/other')).toBe(1)
  })
})
