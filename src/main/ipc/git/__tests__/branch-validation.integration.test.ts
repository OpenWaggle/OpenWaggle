import { describe, expect, it } from 'vitest'
import { validateGitBranchName } from '../branch-mutations'
import { createRepositoryWithWorktree, git } from './commit.test-harness'

describe('validateGitBranchName', () => {
  it('rejects both ancestor and descendant collisions against real Git refs', async () => {
    const { repository, worktree } = await createRepositoryWithWorktree()
    await git(repository, ['branch', 'feature/current', 'main'])

    await expect(validateGitBranchName(worktree, 'feature/current/child')).resolves.toEqual({
      ok: false,
      code: 'branch-exists',
      message: 'Branch "feature/current/child" conflicts with existing ref "feature/current".',
    })
    await expect(validateGitBranchName(worktree, 'feature')).resolves.toEqual({
      ok: false,
      code: 'branch-exists',
      message: 'Branch "feature" conflicts with existing ref "feature/current".',
    })
  })
})
