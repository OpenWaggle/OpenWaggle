import { WorkingPath } from '@shared/types/brand'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useUIStore } from '@/shell/ui-store'
import { useStackedGitActions } from '../useStackedGitActions'

const runStackedGitAction = vi.hoisted(() => vi.fn())

vi.mock('@/shared/lib/ipc', () => ({ api: { runStackedGitAction } }))

describe('useStackedGitActions', () => {
  beforeEach(() => {
    useUIStore.setState({ toastMessage: null, toastData: null })
    runStackedGitAction.mockReset()
  })

  it('reports a successful commit whose Session Output projection failed as an error', async () => {
    runStackedGitAction.mockResolvedValue({
      ok: true,
      action: 'commit',
      branch: { status: 'unchanged', name: null },
      commit: { commitHash: 'abc123', summary: 'Session summary' },
      commitOutput: {
        ok: false,
        retryPersisted: false,
        message: 'The commit succeeded, but its Output and durable retry could not be recorded.',
      },
      changeRequest: null,
    })
    const { result } = renderHook(() =>
      useStackedGitActions({ workingPath: WorkingPath('/project') }),
    )

    await act(() => result.current.run('commit'))

    expect(useUIStore.getState().toastData).toEqual({
      message: 'The commit succeeded, but its Output and durable retry could not be recorded.',
      variant: 'error',
    })
  })

  it('reports both a later push failure and the earlier commit Output failure', async () => {
    runStackedGitAction.mockResolvedValue({
      ok: false,
      phase: 'push',
      code: 'push-failed',
      message: 'The push was rejected.',
      commit: { commitHash: 'abc123', summary: 'Session summary' },
      commitOutput: {
        ok: false,
        retryPersisted: true,
        message: 'The commit Output will be retried automatically.',
      },
    })
    const { result } = renderHook(() =>
      useStackedGitActions({ workingPath: WorkingPath('/project') }),
    )

    await act(() => result.current.run('commit_push'))

    expect(useUIStore.getState().toastData).toEqual({
      message: 'The push was rejected. The commit Output will be retried automatically.',
      variant: 'error',
    })
  })
})
