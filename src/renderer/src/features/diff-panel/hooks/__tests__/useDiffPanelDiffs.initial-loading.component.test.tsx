import { WorkingPath } from '@shared/types/brand'
import { act, render, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useDiffPanelDiffs } from '../useDiffPanelDiffs'

const getGitDiffMock = vi.hoisted(() => vi.fn(() => new Promise(() => {})))

vi.mock('@/shared/lib/ipc', () => ({
  api: {
    getGitDiff: getGitDiffMock,
    getGitBranchDiff: vi.fn(() => new Promise(() => {})),
  },
}))

describe('useDiffPanelDiffs initial feedback', () => {
  beforeEach(() => {
    getGitDiffMock.mockReset()
    getGitDiffMock.mockImplementation(() => new Promise(() => {}))
  })

  it('reports a known working-tree request as loading on the first render', () => {
    const observedLoadingStates: boolean[] = []

    function Probe() {
      observedLoadingStates.push(
        useDiffPanelDiffs(WorkingPath('/repo'), { kind: 'unstaged' }).isLoading,
      )
      return null
    }

    render(<Probe />)

    expect(observedLoadingStates[0]).toBe(true)
    expect(getGitDiffMock).toHaveBeenCalledWith('/repo')
  })

  it('clears a previous failure as soon as a retry starts', async () => {
    getGitDiffMock.mockResolvedValueOnce({
      ok: false,
      code: 'unknown',
      message: 'Git failed.',
    })
    const { result } = renderHook(() =>
      useDiffPanelDiffs(WorkingPath('/repo'), { kind: 'unstaged' }),
    )

    await waitFor(() => expect(result.current.error).toBe('Git failed.'))

    act(() => {
      void result.current.refreshDiff(WorkingPath('/repo'))
    })

    expect(result.current.isLoading).toBe(true)
    expect(result.current.error).toBeNull()
  })
})
