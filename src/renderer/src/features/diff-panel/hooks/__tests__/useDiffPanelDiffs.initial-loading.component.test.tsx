import { WorkingPath } from '@shared/types/brand'
import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useDiffPanelDiffs } from '../useDiffPanelDiffs'

const getGitDiffMock = vi.hoisted(() => vi.fn(() => new Promise(() => {})))

vi.mock('@/shared/lib/ipc', () => ({
  api: {
    getGitDiff: getGitDiffMock,
    getGitBranchDiff: vi.fn(() => new Promise(() => {})),
  },
}))

describe('useDiffPanelDiffs initial feedback', () => {
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
})
