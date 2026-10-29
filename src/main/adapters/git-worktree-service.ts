import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { app } from 'electron'
import { GitWorktreeService } from '../ports/git-worktree-service'
import {
  createGitWorktree,
  listGitWorktrees,
  removeGitWorktree,
  validateGitWorktreeRemoval,
} from './git/worktree'
import { inspectLinkedWorktree } from './git/worktree-membership'
import {
  checkoutTopLevel,
  countUncommittedChanges,
  countUnpublishedCommits,
} from './git/worktree-usage-git'

export const GitWorktreeServiceLive = Layer.succeed(
  GitWorktreeService,
  GitWorktreeService.of({
    create: (projectPath, payload) => Effect.promise(() => createGitWorktree(projectPath, payload)),
    remove: (projectPath, payload) => Effect.promise(() => removeGitWorktree(projectPath, payload)),
    validateRemoval: (projectPath, payload) =>
      Effect.promise(() => validateGitWorktreeRemoval(projectPath, payload)),
    inspectLinkedWorktree: (projectPath, candidatePath) =>
      Effect.tryPromise({
        try: () => inspectLinkedWorktree(projectPath, candidatePath),
        catch: (error) => (error instanceof Error ? error : new Error(String(error))),
      }),
    list: (projectPath) => Effect.promise(() => listGitWorktrees(projectPath)),
    countUnpublishedCommits: (worktreePath) =>
      Effect.promise(() => countUnpublishedCommits(worktreePath)),
    countUncommittedChanges: (worktreePath) =>
      Effect.promise(() => countUncommittedChanges(worktreePath)),
    // A packaged app runs from its bundle, which is no checkout, so this is null there.
    applicationCheckout: () =>
      Effect.promise(() =>
        app.isPackaged ? Promise.resolve(null) : checkoutTopLevel(app.getAppPath()),
      ),
  }),
)
