import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { GitWorktreeService } from '../ports/git-worktree-service'
import { createGitWorktree, removeGitWorktree } from './git/worktree'

export const GitWorktreeServiceLive = Layer.succeed(
  GitWorktreeService,
  GitWorktreeService.of({
    create: (projectPath, payload) => Effect.promise(() => createGitWorktree(projectPath, payload)),
    remove: (projectPath, payload) => Effect.promise(() => removeGitWorktree(projectPath, payload)),
  }),
)
