import * as Effect from 'effect/Effect'
import { BrowserWindow, dialog, type OpenDialogOptions } from 'electron'
import {
  getProjectPreferences,
  isProjectToolCallTrusted,
  recordToolCallApproval,
  setProjectPreferences,
} from '../config/project-config'
import { typedHandle } from './typed-ipc'

function createProjectFolderDialogOptions(): OpenDialogOptions {
  return {
    properties: ['openDirectory'],
    title: 'Select Project Folder',
  }
}

export function registerProjectHandlers(): void {
  typedHandle('project:select-folder', (event) =>
    Effect.gen(function* () {
      const ownerWindow = BrowserWindow.fromWebContents(event.sender)
      const dialogOptions = createProjectFolderDialogOptions()
      const result = yield* Effect.promise(() =>
        ownerWindow
          ? dialog.showOpenDialog(ownerWindow, dialogOptions)
          : dialog.showOpenDialog(dialogOptions),
      )

      if (result.canceled || result.filePaths.length === 0) {
        return null
      }

      return result.filePaths[0] ?? null
    }),
  )

  typedHandle(
    'project-config:is-tool-call-trusted',
    (_event, projectPath: string, toolName, rawArgs: string) =>
      Effect.promise(() => isProjectToolCallTrusted(projectPath, toolName, rawArgs)),
  )

  typedHandle(
    'project-config:record-tool-approval',
    (_event, projectPath: string, toolName, rawArgs: string) =>
      Effect.promise(() =>
        recordToolCallApproval(projectPath, toolName, rawArgs, 'tool-approval'),
      ).pipe(Effect.asVoid),
  )

  typedHandle('project-config:get-preferences', (_event, projectPath: string) =>
    Effect.promise(() => getProjectPreferences(projectPath)).pipe(
      Effect.map((prefs) => prefs ?? null),
    ),
  )

  typedHandle('project-config:set-preferences', (_event, projectPath: string, preferences) =>
    Effect.promise(() => setProjectPreferences(projectPath, preferences)),
  )

  typedHandle('dialog:confirm', (_event, message: string, detail?: string) =>
    Effect.gen(function* () {
      const result = yield* Effect.promise(() =>
        dialog.showMessageBox({
          type: 'warning',
          buttons: ['Cancel', 'Confirm'],
          defaultId: 0,
          cancelId: 0,
          message,
          detail,
        }),
      )
      return result.response === 1
    }),
  )
}
