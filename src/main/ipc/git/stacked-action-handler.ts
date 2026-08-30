import { decodeUnknownOrThrow, Schema } from '@shared/schema'
import type {
  GitRunStackedActionOptions,
  GitRunStackedActionResult,
  OpenChangeRequestPayload,
} from '@shared/types/git'
import { GIT_STACKED_ACTIONS } from '@shared/types/git'
import {
  type DefaultBranchActionDialogCopy,
  defaultBranchActionLabel,
  requiresDefaultBranchConfirmation,
  resolveDefaultBranchActionDialogCopy,
  targetsDefaultRef,
} from '@shared/utils/git-stacked-action'
import * as Effect from 'effect/Effect'
import type { IpcMainInvokeEvent, MessageBoxOptions } from 'electron'
import { getSourceControlProvider } from '../../adapters/source-control'
import { browserWindowFromWebContents, showMessageBox } from '../../desktop-ui'
import { typedHandle } from '../typed-ipc'
import { listGitBranches } from './branch-list'
import { createGitBranch } from './branch-mutations'
import { commitGit } from './commit-handler'
import { resolveDefaultRef } from './default-ref'
import { pullCurrentBranch, pushCurrentBranch } from './push-service'
import { projectPathSchema, runGit } from './shared'
import { runStackedGitAction, type StackedActionDeps } from './stacked-action-service'
import { invalidateGitStatusCache } from './status-cache'
import { GIT_RAW_PATHS } from './status-constants'
import { invalidateVcsStatus, readLocalVcsStatus } from './vcs-status-cache'
import { detectSourceControlProvider } from './vcs-status-parse'
import { resolvePrimaryRemote, resolvePrimaryRemoteUrl } from './vcs-status-service'
import { resolveRepositoryRoot } from './working-tree-service'

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

function repositoryWebUrl(remoteUrl: string) {
  const scp = /^(?:[^@]+@)?(?<host>[^:]+):(?<path>.+)$/u.exec(remoteUrl)
  if (scp?.groups?.host && scp.groups.path) {
    return `https://${scp.groups.host}/${scp.groups.path.replace(/\.git$/u, '')}`
  }
  try {
    const url = new URL(remoteUrl)
    const repositoryPath = url.pathname.replace(/^\/+|\.git$/gu, '')
    return repositoryPath ? `https://${url.hostname}/${repositoryPath}` : null
  } catch {
    return null
  }
}

async function buildChangeRequestFallbackUrl(
  projectPath: string,
  payload: OpenChangeRequestPayload,
) {
  const remoteUrl = await resolvePrimaryRemoteUrl(projectPath)
  if (!remoteUrl) return null
  const provider = detectSourceControlProvider(remoteUrl)
  const webUrl = repositoryWebUrl(remoteUrl)
  if (!provider || !webUrl) return null
  if (provider.id === 'github') {
    const url = new URL(
      `${webUrl}/compare/${encodeURIComponent(payload.baseRef)}...${encodeURIComponent(payload.headRef)}`,
    )
    url.searchParams.set('expand', '1')
    url.searchParams.set('title', payload.title)
    if (payload.body) url.searchParams.set('body', payload.body)
    return url.toString()
  }
  const url = new URL(`${webUrl}/-/merge_requests/new`)
  url.searchParams.set('merge_request[source_branch]', payload.headRef)
  url.searchParams.set('merge_request[target_branch]', payload.baseRef)
  url.searchParams.set('merge_request[title]', payload.title)
  if (payload.body) url.searchParams.set('merge_request[description]', payload.body)
  if (payload.draft) url.searchParams.set('merge_request[draft]', 'true')
  return url.toString()
}

function createStackedActionDeps(): StackedActionDeps {
  return {
    hasWorkingTreeChanges: async (projectPath) => {
      const result = await runGit(projectPath, [...GIT_RAW_PATHS, 'status', '--porcelain=v1'])
      if (result.code !== 0) {
        // Ignoring the exit code made an unreadable repository indistinguishable from a clean
        // one, so the commit phase was skipped and the action reported success regardless.
        return { ok: false, message: result.stderr.trim() || 'Could not read the working tree.' }
      }
      return { ok: true, hasChanges: result.stdout.trim().length > 0 }
    },
    listBranchNames: async (projectPath) => {
      const list = await listGitBranches(projectPath)
      const names: string[] = []
      for (const branch of list.branches) {
        names.push(branch.isRemote ? branch.name.split('/').slice(1).join('/') : branch.name)
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
      /*
       * Stage exactly what the caller selected, and nothing when the selection is empty.
       *
       * This used to fall back to `git add --all`, which has no pathspec and therefore covers
       * the whole repository - not just the opened directory. In `local` environment mode that
       * swept every unrelated in-flight edit in the user's own checkout into the commit, and
       * `commit_push*` then pushed it. The fallback was reached exactly when nothing was on
       * display, which is the case where committing everything is least defensible, so an
       * empty selection now reports that there is nothing to commit.
       */
      const selected = paths?.filter((entry) => entry.trim().length > 0) ?? []
      if (selected.length === 0) {
        return {
          ok: false,
          code: 'nothing-to-commit',
          message: 'Select the files to commit: nothing was staged for this action.',
        }
      }
      /*
       * Staged and committed from the repository root, because the paths are repository-relative -
       * that is what `git status --porcelain` reports, and what the renderer passes through. Running
       * them from an opened subdirectory resolved them relative to that subdirectory instead:
       * verified that `git add -- packages/app/x.txt` from `packages/app` fails with
       * "pathspec ... did not match any files". `git add --all` hid this because it takes no
       * pathspec. Revert all is already re-based onto the root; commit now agrees with it.
       */
      const repositoryRoot = (await resolveRepositoryRoot(projectPath)) ?? projectPath
      /*
       * Staging is left to `commitGit`, which handles the awkward cases: a path gone from disk needs `-A`,
       * and an already-staged rename's source matches nothing for `add` while still needing to be in the
       * commit pathspec. Adding here as well duplicated that logic badly - it batched, which is fatal.
       */
      return commitGit(repositoryRoot, { message, amend: false, paths: [...selected] })
    },
    push: (projectPath) => pushCurrentBranch(projectPath),
    pull: (projectPath) => pullCurrentBranch(projectPath),
    openChangeRequest: async (projectPath, payload) => {
      const provider = getSourceControlProvider(
        detectSourceControlProvider(await resolvePrimaryRemoteUrl(projectPath))?.id,
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
      const primaryRemote = await resolvePrimaryRemote(projectPath)
      return resolveDefaultRef(projectPath, primaryRemote?.name ?? 'origin')
    },
    buildChangeRequestFallbackUrl,
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
    /*
     * Fail closed. A gate that skips itself whenever it cannot read the repository is not a
     * gate: any `git status` failure used to wave a commit-and-push straight through. When the
     * ref is unknown, treat it as risky and ask - the action itself may still be fine, the user
     * just gets the last word.
     */
    if (!local.ok) {
      return yield* askDefaultBranchConfirmation(event, {
        title: 'Continue without checking the current ref?',
        description: `The current ref could not be read (${local.message}), so it is not known whether this action targets the default ref. Continue anyway?`,
        continueLabel: 'Continue',
      })
    }
    /*
     * Either the ref you are on or the ref a push would write. A push follows the upstream mapping, so standing
     * on `feature` with an upstream of `origin/main` writes `main` - verified against real git, which reported
     * `feature -> main`. Judging only the current ref waved that straight through, which is precisely the push
     * this gate exists to catch.
     */
    if (
      options.createFeatureBranch === true ||
      !requiresDefaultBranchConfirmation(options.action, targetsDefaultRef(local.status))
    ) {
      return true
    }
    const copy = resolveDefaultBranchActionDialogCopy({
      action: options.action,
      // Name what would be written, which is the destination when it differs from the branch you are on.
      branchName: defaultBranchActionLabel(local.status),
      includesCommit: options.action.startsWith('commit'),
      provider: local.status.sourceControlProvider?.id ?? null,
    })
    return yield* askDefaultBranchConfirmation(event, copy)
  })
}

/** Modal confirmation shown from main, so the renderer cannot skip it. */
function askDefaultBranchConfirmation(
  event: IpcMainInvokeEvent,
  copy: DefaultBranchActionDialogCopy,
) {
  return Effect.gen(function* () {
    const ownerWindow = browserWindowFromWebContents(event.sender)
    const dialogOptions = {
      type: 'warning',
      buttons: ['Cancel', copy.continueLabel],
      defaultId: 0,
      cancelId: 0,
      message: copy.title,
      detail: copy.description,
    } satisfies MessageBoxOptions
    const confirmation = yield* Effect.promise(() => showMessageBox(ownerWindow, dialogOptions))
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
