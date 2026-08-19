import { SessionId, WorkingPath } from '@shared/types/brand'
import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DiffScopeSelection } from '@/features/diff-panel/state/diff-scope-store'
import { api } from '@/shared/lib/ipc'
import { useDisplayedDiff } from '../useDisplayedDiff'

vi.mock('@/shared/lib/ipc', () => ({
  api: { getGitDiff: vi.fn(), getGitBranchDiff: vi.fn(), getTurnDiff: vi.fn() },
}))

const SESSION = SessionId('session-a')
const WORKING = WorkingPath('/repo')

function turnScope(turnId: string): DiffScopeSelection {
  return { kind: 'turn', turnId, filePath: null, revealRequestId: 0 }
}

function turnDiff(filePath: string) {
  return {
    turnId: 'turn',
    diff: `diff --git a/${filePath} b/${filePath}\n--- a/${filePath}\n+++ b/${filePath}\n@@ -1 +1 @@\n-a\n+b\n`,
    files: [],
    insertions: 1,
    deletions: 1,
  }
}

describe('useDisplayedDiff in Turn scope', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(api.getGitDiff).mockResolvedValue({ ok: true, files: [] })
  })

  it('reports loading rather than an empty diff while a turn is being read', async () => {
    /*
     * The turn scope was hard-coded as never loading, so switching into Turns rendered
     * "No changes to review" until the checkpoint read returned - telling the user a past turn
     * changed nothing.
     */
    let resolveTurn: ((value: ReturnType<typeof turnDiff>) => void) | undefined
    vi.mocked(api.getTurnDiff).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveTurn = resolve
        }),
    )

    const { result } = renderHook(() =>
      useDisplayedDiff({
        sessionId: SESSION,
        workingPath: WORKING,
        selection: turnScope('t1'),
        refreshToken: 0,
      }),
    )

    await waitFor(() => expect(result.current.isLoading).toBe(true))
    expect(result.current.fileDiffs).toEqual([])
    expect(result.current.loadError).toBeNull()

    resolveTurn?.(turnDiff('turn1.ts'))
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.fileDiffs.map((file) => file.path)).toEqual(['turn1.ts'])
  })

  it('does not show the previous turn while a newly selected turn loads', async () => {
    /*
     * The old turn's files stayed on screen under the new turn's label, and a comment written in that
     * window took its snippet from the old patch while being stored against the new turn - exactly the
     * mis-anchoring the review key was introduced to prevent.
     */
    vi.mocked(api.getTurnDiff).mockResolvedValueOnce(turnDiff('turn1.ts'))
    const { result, rerender } = renderHook(
      (selection: DiffScopeSelection) =>
        useDisplayedDiff({
          sessionId: SESSION,
          workingPath: WORKING,
          selection,
          refreshToken: 0,
        }),
      { initialProps: turnScope('t1') },
    )
    await waitFor(() => expect(result.current.fileDiffs.map((f) => f.path)).toEqual(['turn1.ts']))

    let resolveSecond: ((value: ReturnType<typeof turnDiff>) => void) | undefined
    vi.mocked(api.getTurnDiff).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSecond = resolve
        }),
    )
    rerender(turnScope('t2'))

    await waitFor(() => expect(result.current.isLoading).toBe(true))
    expect(result.current.fileDiffs).toEqual([])

    resolveSecond?.(turnDiff('turn2.ts'))
    await waitFor(() => expect(result.current.fileDiffs.map((f) => f.path)).toEqual(['turn2.ts']))
  })
})
