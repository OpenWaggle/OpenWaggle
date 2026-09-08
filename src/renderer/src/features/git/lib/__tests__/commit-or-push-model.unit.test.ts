import type { GitStatusSummary, VcsStatus } from '@shared/types/git'
import { describe, expect, it } from 'vitest'
import { resolveCommitCommandActions } from '../commit-or-push-model'

const status: GitStatusSummary = {
  branch: 'feature/session-summary',
  additions: 3,
  deletions: 1,
  filesChanged: 1,
  clean: false,
  ahead: 1,
  behind: 4,
  changedFiles: [
    {
      path: 'src/session-summary.tsx',
      status: 'modified',
      staged: false,
      unstaged: true,
      additions: 3,
      deletions: 1,
    },
  ],
}

const vcsStatus: VcsStatus = {
  isRepo: true,
  refName: 'feature/session-summary',
  defaultRef: 'main',
  isDefaultRef: false,
  pushTargetRef: 'feature/session-summary',
  pushTargetIsDefaultRef: false,
  hasPrimaryRemote: true,
  hasWorkingTreeChanges: true,
  workingTree: { files: [], insertions: 3, deletions: 1 },
  hasUpstream: true,
  aheadCount: 1,
  behindCount: 4,
  aheadOfDefaultCount: 1,
  sourceControlProvider: null,
  changeRequest: null,
}

describe('resolveCommitCommandActions', () => {
  it('does not block an explicit push merely because the fetch upstream is behind', () => {
    const actions = resolveCommitCommandActions({
      status,
      vcsStatus,
      remoteState: 'loaded',
      branchTarget: 'current',
      branchReady: true,
      branchReason: null,
      includeUnstaged: true,
      message: 'Publish the summary',
    })

    expect(actions.find((action) => action.action === 'commit_push')).toMatchObject({
      enabled: true,
      disabledReason: null,
    })
    expect(actions.find((action) => action.action === 'push')).toMatchObject({
      enabled: true,
      disabledReason: null,
    })
  })
})
