import { RepositoryPath, SessionId } from '@shared/types/brand'
import type { GitBranchListResult } from '@shared/types/git'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DiffScopeSelection } from '../../state/diff-scope-store'
import { useBaseRefChoices } from '../useBaseRefChoices'
import { useTurnDiffFiles } from '../useSessionTurns'

const getTurnDiffMock = vi.hoisted(() => vi.fn())
const listGitBranchesMock = vi.hoisted(() => vi.fn())

vi.mock('@/shared/lib/ipc', () => ({
  api: { getTurnDiff: getTurnDiffMock, listGitBranches: listGitBranchesMock },
}))

const SESSION = SessionId('session-1')
const PATCH = [
  'diff --git a/a.ts b/a.ts',
  '--- a/a.ts',
  '+++ b/a.ts',
  '@@ -1 +1 @@',
  '-old',
  '+new',
  '',
].join('\n')

function turn(turnId: string): DiffScopeSelection {
  return { kind: 'turn', turnId, filePath: null, revealRequestId: 0 }
}

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined
  const promise = new Promise<T>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

function branches(...names: readonly string[]): GitBranchListResult {
  return {
    currentBranch: names[0] ?? null,
    branches: names.map((name, index) => ({
      name,
      localName: name,
      fullName: name,
      isCurrent: index === 0,
      isRemote: false,
      upstream: null,
      ahead: 0,
      behind: 0,
    })),
  }
}

beforeEach(() => {
  getTurnDiffMock.mockReset()
  listGitBranchesMock.mockReset()
})

describe('useTurnDiffFiles', () => {
  it('shows no files and no loading when no turn is selected', () => {
    const { result } = renderHook(() => useTurnDiffFiles(SESSION, { kind: 'unstaged' }))

    expect(result.current).toMatchObject({ files: [], error: null, isLoading: false })
    expect(getTurnDiffMock).not.toHaveBeenCalled()
  })

  it('never shows the previous turn under a newly selected one while it loads', async () => {
    const second = deferred<{ turnId: string; diff: string } | null>()
    getTurnDiffMock
      .mockResolvedValueOnce({ turnId: 't1', diff: PATCH })
      .mockReturnValueOnce(second.promise)
    const { result, rerender } = renderHook(
      ({ selection }: { selection: DiffScopeSelection }) => useTurnDiffFiles(SESSION, selection),
      { initialProps: { selection: turn('t1') } },
    )
    expect(result.current.isLoading).toBe(true)
    await waitFor(() => expect(result.current.files).toHaveLength(1))

    rerender({ selection: turn('t2') })

    expect(result.current).toMatchObject({ files: [], error: null, isLoading: true })
    await act(async () => second.resolve(null))
    expect(result.current).toMatchObject({
      files: [],
      error: "This turn's checkpoint is no longer stored, so its diff cannot be shown.",
      isLoading: false,
    })
  })

  it('clears a failure while the retry loads, then shows the retried files', async () => {
    getTurnDiffMock.mockRejectedValueOnce(new Error('disk')).mockResolvedValueOnce({
      turnId: 't1',
      diff: PATCH,
    })
    const { result } = renderHook(() => useTurnDiffFiles(SESSION, turn('t1')))
    await waitFor(() => expect(result.current.error).toBe("This turn's diff could not be loaded."))

    act(() => result.current.retry())

    expect(result.current).toMatchObject({ error: null, isLoading: true })
    await waitFor(() => expect(result.current.files).toHaveLength(1))
    expect(getTurnDiffMock).toHaveBeenCalledTimes(2)
  })
})

describe('useBaseRefChoices', () => {
  it('reports another repository as not loaded until its own branches arrive', async () => {
    const second = deferred<GitBranchListResult>()
    listGitBranchesMock.mockResolvedValueOnce(branches('main')).mockReturnValueOnce(second.promise)
    const { result, rerender } = renderHook(
      ({ path }: { path: RepositoryPath | null }) => useBaseRefChoices(path),
      { initialProps: { path: RepositoryPath('/a') } },
    )
    await waitFor(() => expect(result.current.loaded).toBe(true))

    rerender({ path: RepositoryPath('/b') })

    expect(result.current).toEqual({ choices: [], loaded: false })
    await act(async () => second.resolve(branches('develop')))
    expect(result.current.loaded).toBe(true)
    expect(listGitBranchesMock).toHaveBeenLastCalledWith('/b')
  })

  it('reports nothing loaded without a repository, and after a failed read', async () => {
    const initialProps: { path: RepositoryPath | null } = { path: null }
    const { result, rerender } = renderHook(
      ({ path }: { path: RepositoryPath | null }) => useBaseRefChoices(path),
      { initialProps },
    )
    expect(result.current).toEqual({ choices: [], loaded: false })
    expect(listGitBranchesMock).not.toHaveBeenCalled()

    listGitBranchesMock.mockRejectedValueOnce(new Error('not a repository'))
    rerender({ path: RepositoryPath('/broken') })

    await waitFor(() => expect(listGitBranchesMock).toHaveBeenCalledTimes(1))
    expect(result.current).toEqual({ choices: [], loaded: false })
  })
})
