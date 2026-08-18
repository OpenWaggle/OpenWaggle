import { describe, expect, it } from 'vitest'
import { RepositoryPath, WorkingPath } from '../brand'
import type { OpenWaggleApi } from '../openwaggle-api'

/**
 * Compile-time proof for #155: a working-tree mutation cannot be handed a repository
 * path, and a repository-level list cannot be handed a working path. If either brand
 * stops being enforced, the matching `@ts-expect-error` below becomes unused and the
 * typecheck fails — so this regresses loudly rather than silently.
 *
 * `resolveSessionWorkingDir` is the only producer of a `WorkingPath`; these declared
 * values stand in for its output and for a repository path at a call site.
 */
declare const api: OpenWaggleApi
declare const workingPath: WorkingPath
declare const repositoryPath: RepositoryPath

// Correct pairings compile.
void (() => api.commitGit(workingPath, { message: 'm', amend: false, paths: [] }))
void (() => api.stageAllGitChanges(workingPath))
void (() => api.getGitDiff(workingPath))
void (() => api.listGitBranches(repositoryPath))
void (() => api.listGitWorktrees(repositoryPath))

// A repository path fed to a working-tree mutation must not compile.
// @ts-expect-error repository path is not a working path
void (() => api.commitGit(repositoryPath, { message: 'm', amend: false, paths: [] }))
// @ts-expect-error repository path is not a working path
void (() => api.stageAllGitChanges(repositoryPath))
// @ts-expect-error repository path is not a working path
void (() => api.revertAllGitChanges(repositoryPath))
// @ts-expect-error repository path is not a working path
void (() => api.getGitDiff(repositoryPath))

// A working path fed to a repository-level list must not compile.
// @ts-expect-error working path is not a repository path
void (() => api.listGitBranches(workingPath))
// @ts-expect-error working path is not a repository path
void (() => api.listGitWorktrees(workingPath))

describe('git path brands', () => {
  it('constructs distinct brands from the same string at the boundary', () => {
    expect(String(WorkingPath('/repo'))).toBe('/repo')
    expect(String(RepositoryPath('/repo'))).toBe('/repo')
  })
})
