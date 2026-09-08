import { describe, expect, it } from 'vitest'
import { listGitBranches } from '../branch-list'
import { checkoutGitBranch } from '../branch-mutations'
import { createRepositoryWithWorktree, git } from './commit.test-harness'

describe('slash-containing Git remote names', () => {
  it('lists and checks out a remote branch using the longest configured remote prefix', async () => {
    const { repository, worktree } = await createRepositoryWithWorktree()
    await git(repository, ['remote', 'add', 'team', repository])
    // Newer Git rejects overlapping names in `remote add`, but existing repositories
    // can still contain them. Seed that legacy config directly to test our reader.
    await git(repository, ['config', 'remote.team/fork.url', repository])
    await git(repository, [
      'config',
      'remote.team/fork.fetch',
      '+refs/heads/*:refs/remotes/team/fork/*',
    ])
    await git(repository, ['update-ref', 'refs/remotes/team/fork/feature', 'HEAD'])

    const listed = await listGitBranches(worktree)

    expect(listed.branches).toContainEqual(
      expect.objectContaining({
        name: 'team/fork/feature',
        localName: 'feature',
        isRemote: true,
      }),
    )

    await expect(checkoutGitBranch(worktree, { name: 'team/fork/feature' })).resolves.toMatchObject(
      { ok: true },
    )
    await expect(git(worktree, ['branch', '--show-current'])).resolves.toBe('feature\n')
    await expect(
      git(worktree, ['for-each-ref', '--format=%(upstream:short)', 'refs/heads/feature']),
    ).resolves.toBe('team/fork/feature\n')
  })
})
