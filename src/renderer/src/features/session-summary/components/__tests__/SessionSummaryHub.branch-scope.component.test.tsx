import { RepositoryPath } from '@shared/types/brand'
import type { GitBranchInfo } from '@shared/types/git'
import { fireEvent, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  gitState,
  renderHub,
  setupSessionSummaryHubHarness,
  useGit,
} from './session-summary-hub.test-harness'

function branch(name: string): GitBranchInfo {
  return {
    name,
    localName: name,
    fullName: `refs/heads/${name}`,
    isCurrent: false,
    isRemote: false,
    upstream: null,
    ahead: 0,
    behind: 0,
  }
}

describe('SessionSummaryHub branch scope', () => {
  beforeEach(setupSessionSummaryHubHarness)

  it('never exposes a previous repository branch list during a session switch', () => {
    const refreshBranches = vi.fn()
    const checkoutBranch = vi.fn()
    useGit.mockReturnValue(
      gitState({
        repositoryPath: RepositoryPath('/project-b'),
        branchesRepositoryPath: RepositoryPath('/project-a'),
        branches: {
          currentBranch: 'old-main',
          branches: [branch('old-main'), branch('secret/previous-project')],
        },
        refreshBranches,
        checkoutBranch,
      }),
    )

    renderHub()
    fireEvent.click(
      screen.getByRole('button', { name: 'Branch: codex/session-summary-resource-hub' }),
    )

    expect(refreshBranches).toHaveBeenCalledWith(RepositoryPath('/project-b'))
    expect(screen.queryByText('secret/previous-project')).toBeNull()
    expect(screen.getByText('No branches found.')).toBeInTheDocument()
    expect(checkoutBranch).not.toHaveBeenCalled()
  })
})
