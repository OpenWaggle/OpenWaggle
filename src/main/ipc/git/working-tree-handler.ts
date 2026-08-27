import { decodeUnknownOrThrow } from '@shared/schema'
import type { GitWorkingTreeMutationResult } from '@shared/types/git'
import * as Effect from 'effect/Effect'
import type { IpcMainInvokeEvent, MessageBoxOptions } from 'electron'
import { browserWindowFromWebContents, showMessageBox } from '../../desktop-ui'
import { typedHandle } from '../typed-ipc'
import { projectPathSchema } from './shared'
import { invalidateGitStatusCache } from './status-handler'
import { invalidateVcsStatus } from './vcs-status-cache'
import {
  resolveRepositoryRoot,
  revertAllGitChanges,
  stageAllGitChanges,
} from './working-tree-service'

const REVERT_ALL_CONFIRMATION_DETAIL =
  'This resets all tracked and staged changes to HEAD and permanently deletes untracked files and folders. Ignored files and nested Git repositories are kept. If either would obstruct restoring HEAD, nothing is changed. This cannot be undone.'

/**
 * Name the real scope when the opened folder is not the repository root.
 *
 * The mutation is re-based onto the root and uses whole-repository pathspecs, so opening
 * `/repo/packages/app` and confirming discards changes and deletes untracked files anywhere under
 * `/repo` - verified against real git. The dialog is the only gate on the one irreversible action
 * in this feature, so it has to say which tree it is about to reset.
 */
function revertAllDetail(projectPath: string, repositoryRoot: string | null) {
  if (repositoryRoot === null || repositoryRoot === projectPath) {
    return REVERT_ALL_CONFIRMATION_DETAIL
  }
  return `This affects the whole repository, including files outside the folder you opened. ${REVERT_ALL_CONFIRMATION_DETAIL}`
}

function workingTreeActionHandler(
  action: (projectPath: string) => Promise<GitWorkingTreeMutationResult>,
) {
  return (_event: unknown, rawPath: unknown) =>
    Effect.gen(function* () {
      const projectPath = decodeUnknownOrThrow(projectPathSchema, rawPath)
      const result = yield* Effect.promise(() => action(projectPath))
      // Scoped to the tree we mutated: a global invalidation made every other
      // session's panel re-run a full diff for a change that did not touch it.
      invalidateGitStatusCache(projectPath)
      invalidateVcsStatus(projectPath)
      return result
    })
}

function revertWorkingTreeHandler(event: IpcMainInvokeEvent, rawPath: unknown) {
  return Effect.gen(function* () {
    const projectPath = decodeUnknownOrThrow(projectPathSchema, rawPath)
    const repositoryRoot = yield* Effect.promise(() => resolveRepositoryRoot(projectPath))
    const ownerWindow = browserWindowFromWebContents(event.sender)
    const dialogOptions = {
      type: 'warning',
      buttons: ['Cancel', 'Confirm'],
      defaultId: 0,
      cancelId: 0,
      message: 'Revert all changes?',
      detail: revertAllDetail(projectPath, repositoryRoot),
    } satisfies MessageBoxOptions
    const confirmation = yield* Effect.promise(() => showMessageBox(ownerWindow, dialogOptions))
    if (confirmation.response !== 1) {
      return {
        ok: false,
        code: 'cancelled',
        message: 'Revert all cancelled.',
      } satisfies GitWorkingTreeMutationResult
    }

    const result = yield* Effect.promise(() => revertAllGitChanges(projectPath))
    invalidateGitStatusCache(projectPath)
    invalidateVcsStatus(projectPath)
    return result
  })
}

export function registerGitWorkingTreeHandlers(): void {
  typedHandle('git:working-tree:stage-all', workingTreeActionHandler(stageAllGitChanges))
  typedHandle('git:working-tree:revert-all', revertWorkingTreeHandler)
}
