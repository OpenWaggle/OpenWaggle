import { decodeUnknownOrThrow } from '@shared/schema'
import type { GitWorkingTreeMutationResult } from '@shared/types/git'
import * as Effect from 'effect/Effect'
import { BrowserWindow, dialog, type IpcMainInvokeEvent, type MessageBoxOptions } from 'electron'
import { typedHandle } from '../typed-ipc'
import { projectPathSchema } from './shared'
import { invalidateGitStatusCache } from './status-handler'
import { invalidateVcsStatus } from './vcs-status-cache'
import { revertAllGitChanges, stageAllGitChanges } from './working-tree-service'

const REVERT_ALL_CONFIRMATION_DETAIL =
  'This resets all tracked and staged changes to HEAD and permanently deletes untracked files and folders. Ignored files and nested Git repositories are kept. If either would obstruct restoring HEAD, nothing is changed. This cannot be undone.'

function workingTreeActionHandler(
  action: (projectPath: string) => Promise<GitWorkingTreeMutationResult>,
) {
  return (_event: unknown, rawPath: unknown) =>
    Effect.gen(function* () {
      const projectPath = decodeUnknownOrThrow(projectPathSchema, rawPath)
      const result = yield* Effect.promise(() => action(projectPath))
      invalidateGitStatusCache()
      invalidateVcsStatus(projectPath)
      return result
    })
}

function revertWorkingTreeHandler(event: IpcMainInvokeEvent, rawPath: unknown) {
  return Effect.gen(function* () {
    const projectPath = decodeUnknownOrThrow(projectPathSchema, rawPath)
    const ownerWindow = BrowserWindow.fromWebContents(event.sender)
    const dialogOptions = {
      type: 'warning',
      buttons: ['Cancel', 'Confirm'],
      defaultId: 0,
      cancelId: 0,
      message: 'Revert all changes?',
      detail: REVERT_ALL_CONFIRMATION_DETAIL,
    } satisfies MessageBoxOptions
    const confirmation = yield* Effect.promise(() =>
      ownerWindow
        ? dialog.showMessageBox(ownerWindow, dialogOptions)
        : dialog.showMessageBox(dialogOptions),
    )
    if (confirmation.response !== 1) {
      return {
        ok: false,
        code: 'cancelled',
        message: 'Revert all cancelled.',
      } satisfies GitWorkingTreeMutationResult
    }

    const result = yield* Effect.promise(() => revertAllGitChanges(projectPath))
    invalidateGitStatusCache()
    invalidateVcsStatus(projectPath)
    return result
  })
}

export function registerGitWorkingTreeHandlers(): void {
  typedHandle('git:working-tree:stage-all', workingTreeActionHandler(stageAllGitChanges))
  typedHandle('git:working-tree:revert-all', revertWorkingTreeHandler)
}
