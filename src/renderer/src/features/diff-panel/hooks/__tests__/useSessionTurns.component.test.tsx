import { RepositoryPath, SessionId } from '@shared/types/brand'
import type { GitBranchListResult } from '@shared/types/git'
import type { TurnCheckpointSummary } from '@shared/types/turn-diff'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DiffScopeSelection } from '../../state/diff-scope-store'
import { useBaseRefChoices } from '../useBaseRefChoices'
import { useSessionTurns } from '../useSessionTurns'
import { useTurnDiffFiles } from '../useTurnDiffFiles'

const getTurnDiffMock = vi.hoisted(() => vi.fn())
const listGitBranchesMock = vi.hoisted(() => vi.fn())
const listTurnCheckpointsMock = vi.hoisted(() => vi.fn())

vi.mock('@/shared/lib/ipc', () => ({
  api: {
    getTurnDiff: getTurnDiffMock,
    listGitBranches: listGitBranchesMock,
    listTurnCheckpoints: listTurnCheckpointsMock,
  },
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

function turn(turnId: string) {
  return { kind: 'turn', turnId, filePath: null, revealRequestId: 0 } satisfies DiffScopeSelection
}

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined
  const promise = new Promise<T>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

function branches(...names: readonly string[]) {
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
  listTurnCheckpointsMock.mockReset()
})

function checkpoint(turnId: string) {
  return {
    turnId,
    turnIndex: 0,
    createdAt: 1,
    insertions: 1,
    deletions: 0,
  } satisfies TurnCheckpointSummary
}

describe('useSessionTurns', () => {
  it('keeps the list through a refresh but never shows it under another Session', async () => {
    const refreshed = deferred<readonly TurnCheckpointSummary[]>()
    const other = deferred<readonly TurnCheckpointSummary[]>()
    listTurnCheckpointsMock
      .mockResolvedValueOnce([checkpoint('t1')])
      .mockReturnValueOnce(refreshed.promise)
      .mockReturnValueOnce(other.promise)
    const initialProps: { sessionId: SessionId | null; refresh: number } = {
      sessionId: SESSION,
      refresh: 0,
    }
    const { result, rerender } = renderHook(
      ({ sessionId, refresh }: typeof initialProps) => useSessionTurns(sessionId, refresh),
      { initialProps },
    )
    await waitFor(() => expect(result.current).toEqual([checkpoint('t1')]))

    rerender({ sessionId: SESSION, refresh: 1 })
    expect(result.current).toEqual([checkpoint('t1')])
    await act(async () => refreshed.resolve([checkpoint('t1'), checkpoint('t2')]))
    expect(result.current).toHaveLength(2)

    rerender({ sessionId: SessionId('session-2'), refresh: 1 })
    expect(result.current).toEqual([])
    await act(async () => other.resolve([checkpoint('t9')]))
    expect(result.current).toEqual([checkpoint('t9')])

    rerender({ sessionId: null, refresh: 1 })
    expect(result.current).toEqual([])
  })
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
