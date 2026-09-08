import { WorkingPath } from '@shared/types/brand'
import type { GitRunStackedActionResult } from '@shared/types/git'
import type { IpcEventPayload } from '@shared/types/ipc'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useUIStore } from '@/shell/ui-store'
import { useStackedGitActions } from '../useStackedGitActions'

const runStackedGitAction = vi.hoisted(() => vi.fn())
const cancelStackedGitAction = vi.hoisted(() => vi.fn())
const onGitStackedActionProgress = vi.hoisted(() => vi.fn())

vi.mock('@/shared/lib/ipc', () => ({
  api: { runStackedGitAction, cancelStackedGitAction, onGitStackedActionProgress },
}))

describe('useStackedGitActions', () => {
  beforeEach(() => {
    useUIStore.setState({ toastMessage: null, toastData: null })
    runStackedGitAction.mockReset()
    cancelStackedGitAction.mockReset().mockResolvedValue(true)
    onGitStackedActionProgress.mockReset().mockReturnValue(vi.fn())
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

  it('scopes progress and cancellation to its generated operation id', async () => {
    let progressListener:
      | ((payload: IpcEventPayload<'git:stacked-action:progress'>) => void)
      | undefined
    onGitStackedActionProgress.mockImplementation((listener) => {
      progressListener = listener
      return vi.fn()
    })
    let resolveRun: (result: GitRunStackedActionResult) => void = () => undefined
    runStackedGitAction.mockReturnValue(
      new Promise<GitRunStackedActionResult>((resolve) => {
        resolveRun = resolve
      }),
    )
    const { result } = renderHook(() =>
      useStackedGitActions({ workingPath: WorkingPath('/project') }),
    )

    let runPromise: Promise<GitRunStackedActionResult | undefined> | undefined
    act(() => {
      runPromise = result.current.run('commit_push', { commitMessage: 'Ship it' })
    })
    await waitFor(() => expect(result.current.isRunning).toBe(true))
    const options = runStackedGitAction.mock.calls[0]?.[1]
    expect(options.operationId).toEqual(expect.any(String))
    act(() => {
      progressListener?.({
        operationId: options.operationId,
        workingPath: '/project',
        progress: { phase: 'commit', label: 'Committing...', index: 0, total: 2 },
      })
    })
    expect(result.current.progress).toMatchObject({ phase: 'commit', total: 2 })

    await act(() => result.current.cancel())
    expect(cancelStackedGitAction).toHaveBeenCalledWith(options.operationId)

    resolveRun({
      ok: false,
      phase: 'push',
      code: 'cancelled',
      message: 'Commit created. Push cancelled before it started.',
      commit: { commitHash: 'abc', summary: 'Ship it' },
    })
    await act(async () => {
      await runPromise
    })
  })
})
