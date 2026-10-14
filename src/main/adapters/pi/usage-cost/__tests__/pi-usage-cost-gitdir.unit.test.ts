import { describe, expect, it } from 'vitest'
import { resolvePrimaryRepositoryFromGitDir } from '../pi-usage-cost-scanner'

describe('resolvePrimaryRepositoryFromGitDir', () => {
  it('strips the worktree gitdir and the .git suffix', () => {
    expect(resolvePrimaryRepositoryFromGitDir('/repo/.git/worktrees/wt1')).toBe('/repo')
    expect(resolvePrimaryRepositoryFromGitDir('/repo/.git')).toBe('/repo')
    expect(resolvePrimaryRepositoryFromGitDir('/srv/repo.git/worktrees/wt1')).toBe('/srv/repo.git')
    expect(resolvePrimaryRepositoryFromGitDir('/not-a-gitdir')).toBeNull()
    expect(resolvePrimaryRepositoryFromGitDir('C:\\repo\\.git\\worktrees\\wt1')).toBe('C:/repo')
  })
})
