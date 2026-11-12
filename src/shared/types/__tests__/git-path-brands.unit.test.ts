import { describe, expect, it } from 'vitest'
import { RepositoryPath, WorkingPath } from '../brand'
import type { OpenWaggleApi } from '../openwaggle-api'

/**
 * Compile-time proof for #155: a working-tree mutation cannot be handed a repository
 * path, and a repository-level list cannot be handed a working path. Each entry of
 * `rejectedPairings` is typed by whether the method's first parameter accepts the other
 * brand; if a brand stops being enforced the type becomes `true`, the `false` value no
 * longer fits and the typecheck fails, so this regresses loudly rather than silently. No
 * directive comment is needed (openwaggle/no-lint-directive-comments, typescript/ban-ts-comment).
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

/** Whether `Method`'s first parameter accepts an `Argument`. */
type AcceptsFirst<Method, Argument> = Method extends (
  first: infer First,
  ...rest: never[]
) => unknown
  ? Argument extends First
    ? true
    : false
  : never

// A repository path fed to a working-tree mutation, or a working path fed to a
// repository-level list, must not compile.
const rejectedPairings: {
  readonly commitGit: AcceptsFirst<OpenWaggleApi['commitGit'], RepositoryPath>
  readonly stageAllGitChanges: AcceptsFirst<OpenWaggleApi['stageAllGitChanges'], RepositoryPath>
  readonly revertAllGitChanges: AcceptsFirst<OpenWaggleApi['revertAllGitChanges'], RepositoryPath>
  readonly getGitDiff: AcceptsFirst<OpenWaggleApi['getGitDiff'], RepositoryPath>
  readonly listGitBranches: AcceptsFirst<OpenWaggleApi['listGitBranches'], WorkingPath>
  readonly listGitWorktrees: AcceptsFirst<OpenWaggleApi['listGitWorktrees'], WorkingPath>
} = {
  commitGit: false,
  stageAllGitChanges: false,
  revertAllGitChanges: false,
  getGitDiff: false,
  listGitBranches: false,
  listGitWorktrees: false,
}

describe('git path brands', () => {
  it('rejects each wrong brand at compile time', () => {
    expect(Object.values(rejectedPairings).every((accepted) => !accepted)).toBe(true)
  })

  it('constructs distinct brands from the same string at the boundary', () => {
    expect(String(WorkingPath('/repo'))).toBe('/repo')
    expect(String(RepositoryPath('/repo'))).toBe('/repo')
  })
})
