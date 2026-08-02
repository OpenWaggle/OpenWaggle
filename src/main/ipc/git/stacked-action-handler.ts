import { decodeUnknownOrThrow, Schema } from '@shared/schema'
import type { GitRunStackedActionOptions } from '@shared/types/git'
import { GIT_STACKED_ACTIONS } from '@shared/types/git'
import * as Effect from 'effect/Effect'
import { getSourceControlProvider } from '../../adapters/source-control'
import { typedHandle } from '../typed-ipc'
import { listGitBranches } from './branch-list'
import { createGitBranch } from './branch-mutations'
import { commitGit } from './commit-handler'
import { pullCurrentBranch, pushCurrentBranch } from './push-service'
import { projectPathSchema, runGit } from './shared'
import { runStackedGitAction, type StackedActionDeps } from './stacked-action-service'
import { invalidateVcsStatus } from './vcs-status-cache'
import { detectSourceControlProvider } from './vcs-status-parse'

const stackedActionOptionsSchema = Schema.Struct({
  action: Schema.Literal(...GIT_STACKED_ACTIONS),
  commitMessage: Schema.optional(Schema.String),
  createFeatureBranch: Schema.optional(Schema.Boolean),
  featureBranchName: Schema.optional(Schema.String),
  baseRef: Schema.optional(Schema.String),
  changeRequestTitle: Schema.optional(Schema.String),
  changeRequestBody: Schema.optional(Schema.String),
  draft: Schema.optional(Schema.Boolean),
})

async function resolveProviderRemoteUrl(projectPath: string): Promise<string | null> {
  const result = await runGit(projectPath, ['remote', 'get-url', 'origin'])
  return result.code === 0 ? result.stdout.trim() || null : null
}

function createStackedActionDeps(): StackedActionDeps {
  return {
    hasWorkingTreeChanges: async (projectPath) => {
      const result = await runGit(projectPath, ['status', '--porcelain=v1'])
      return result.stdout.trim().length > 0
    },
    listBranchNames: async (projectPath) => {
      const list = await listGitBranches(projectPath)
      const names: string[] = []
      for (const branch of list.branches) {
        if (!branch.isRemote) names.push(branch.name)
      }
      return names
    },
    createBranch: async (projectPath, name, baseRef) => {
      const result = await createGitBranch(projectPath, {
        name,
        startPoint: baseRef,
        checkout: true,
      })
      return { ok: result.ok, message: result.message }
    },
    commit: async (projectPath, message) => {
      await runGit(projectPath, ['add', '--all', '--', ':/'])
      return commitGit(projectPath, { message, amend: false, paths: [] })
    },
    push: (projectPath) => pushCurrentBranch(projectPath),
    pull: (projectPath) => pullCurrentBranch(projectPath),
    openChangeRequest: async (projectPath, payload) => {
      const provider = getSourceControlProvider(
        detectSourceControlProvider(await resolveProviderRemoteUrl(projectPath))?.id,
      )
      if (!provider) {
        return { ok: false, code: 'unknown', message: 'No supported source control provider.' }
      }
      return provider.openChangeRequest(projectPath, payload)
    },
  }
}

export function registerGitStackedActionHandlers(): void {
  const deps = createStackedActionDeps()
  typedHandle('git:stacked-action:run', (_event, rawPath: unknown, rawOptions: unknown) =>
    Effect.gen(function* () {
      const projectPath = decodeUnknownOrThrow(projectPathSchema, rawPath)
      const options = decodeUnknownOrThrow(
        stackedActionOptionsSchema,
        rawOptions,
      ) satisfies GitRunStackedActionOptions
      const result = yield* Effect.promise(() => runStackedGitAction(deps, projectPath, options))
      invalidateVcsStatus(projectPath)
      return result
    }),
  )
}
