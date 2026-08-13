import { decodeUnknownOrThrow, Schema } from '@shared/schema'
import type { GitRunStackedActionOptions, GitRunStackedActionResult } from '@shared/types/git'
import { GIT_STACKED_ACTIONS } from '@shared/types/git'
import {
  requiresDefaultBranchConfirmation,
  resolveDefaultBranchActionDialogCopy,
} from '@shared/utils/git-stacked-action'
import * as Effect from 'effect/Effect'
import { BrowserWindow, dialog, type IpcMainInvokeEvent, type MessageBoxOptions } from 'electron'
import { getSourceControlProvider } from '../../adapters/source-control'
import { typedHandle } from '../typed-ipc'
import { listGitBranches } from './branch-list'
import { createGitBranch } from './branch-mutations'
import { commitGit } from './commit-handler'
import { pullCurrentBranch, pushCurrentBranch } from './push-service'
import { projectPathSchema, runGit } from './shared'
import { runStackedGitAction, type StackedActionDeps } from './stacked-action-service'
import { invalidateGitStatusCache } from './status-cache'
import { invalidateVcsStatus, readLocalVcsStatus } from './vcs-status-cache'
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
  paths: Schema.optional(Schema.Array(Schema.String)),
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
    commit: async (projectPath, message, paths) => {
      // Stage the caller's selection when provided; only fall back to staging the
      // whole working tree when nothing was selected (avoids sweeping in the
      // user's unrelated in-flight work in `local` environment mode).
      const selected = paths?.filter((entry) => entry.trim().length > 0) ?? []
      if (selected.length > 0) {
        await runGit(projectPath, ['add', '--', ...selected])
        return commitGit(projectPath, { message, amend: false, paths: [...selected] })
      }
      await runGit(projectPath, ['add', '--all'])
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
    resolveCurrentRef: async (projectPath) => {
      const result = await runGit(projectPath, ['symbolic-ref', '--quiet', '--short', 'HEAD'])
      return result.code === 0 ? result.stdout.trim() || null : null
    },
    resolveDefaultBaseRef: async (projectPath) => {
      const result = await runGit(projectPath, ['rev-parse', '--abbrev-ref', 'origin/HEAD'])
      if (result.code !== 0) return null
      const ref = result.stdout.trim()
      return ref ? ref.replace(/^origin\//, '') : null
    },
  }
}

/**
 * Default-branch confirmation gate (ADR 0012). Runs in main so the renderer
 * cannot bypass it: a commit/push/PR action on the default ref must be confirmed
 * before anything is staged, committed or pushed.
 */
function confirmDefaultBranchAction(
  event: IpcMainInvokeEvent,
  projectPath: string,
  options: GitRunStackedActionOptions,
) {
  return Effect.gen(function* () {
    const local = yield* Effect.promise(() => readLocalVcsStatus(projectPath))
    if (
      !local.ok ||
      !requiresDefaultBranchConfirmation(options.action, local.status.isDefaultRef)
    ) {
      return true
    }
    const copy = resolveDefaultBranchActionDialogCopy({
      action: options.action,
      branchName: local.status.refName ?? 'the default branch',
      includesCommit: options.action.startsWith('commit'),
      provider: local.status.sourceControlProvider?.id ?? null,
    })
    const ownerWindow = BrowserWindow.fromWebContents(event.sender)
    const dialogOptions = {
      type: 'warning',
      buttons: ['Cancel', copy.continueLabel],
      defaultId: 0,
      cancelId: 0,
      message: copy.title,
      detail: copy.description,
    } satisfies MessageBoxOptions
    const confirmation = yield* Effect.promise(() =>
      ownerWindow
        ? dialog.showMessageBox(ownerWindow, dialogOptions)
        : dialog.showMessageBox(dialogOptions),
    )
    return confirmation.response === 1
  })
}

export function registerGitStackedActionHandlers(): void {
  const deps = createStackedActionDeps()
  typedHandle('git:stacked-action:run', (event, rawPath: unknown, rawOptions: unknown) =>
    Effect.gen(function* () {
      const projectPath = decodeUnknownOrThrow(projectPathSchema, rawPath)
      const options = decodeUnknownOrThrow(
        stackedActionOptionsSchema,
        rawOptions,
      ) satisfies GitRunStackedActionOptions
      const confirmed = yield* confirmDefaultBranchAction(event, projectPath, options)
      if (!confirmed) {
        return {
          ok: false,
          phase: 'commit',
          code: 'cancelled',
          message: 'Action cancelled.',
        } satisfies GitRunStackedActionResult
      }
      const result = yield* Effect.promise(() => runStackedGitAction(deps, projectPath, options))
      // Stacked actions commit and push, so the working tree's status changed too.
      invalidateGitStatusCache(projectPath)
      invalidateVcsStatus(projectPath)
      return result
    }),
  )
}
