import * as Effect from 'effect/Effect'
import type { OpenDialogOptions } from 'electron'
import { listGrantsForProject } from '../application/agent-authorization-grants'
import {
  grantProjectAuthorizationOperation,
  revokeProjectAuthorizationOperation,
} from '../application/project-authorization-grant-operation'
import { setProjectPreferencesOperation } from '../application/project-preferences-operation'
import { getProjectPreferences } from '../config/project-config'
import { browserWindowFromWebContents, showMessageBox, showOpenDialog } from '../desktop-ui'
import { validateProjectPath } from './project-path-validation'
import { hostHandle, typedHandle } from './typed-ipc'

function createProjectFolderDialogOptions(): OpenDialogOptions {
  return {
    properties: ['openDirectory'],
    title: 'Select Project Folder',
  }
}

export function registerProjectHandlers(): void {
  typedHandle('project:select-folder', (event) =>
    Effect.gen(function* () {
      const ownerWindow = browserWindowFromWebContents(event.sender)
      const dialogOptions = createProjectFolderDialogOptions()
      const result = yield* Effect.promise(() => showOpenDialog(ownerWindow, dialogOptions))

      if (result.canceled || result.filePaths.length === 0) {
        return null
      }

      return result.filePaths[0] ?? null
    }),
  )

  typedHandle('project-config:get-preferences', (_event, projectPath: string) =>
    Effect.gen(function* () {
      const validatedProjectPath = yield* validateProjectPath(projectPath)
      if (!validatedProjectPath) {
        return null
      }
      const prefs = yield* Effect.promise(() => getProjectPreferences(validatedProjectPath))
      return prefs ?? null
    }),
  )

  hostHandle('project-config:set-preferences', (_event, projectPath: string, preferences) =>
    setProjectPreferencesOperation(projectPath, preferences),
  )

  typedHandle('authorization-grants:list', (_event, projectPath: string) =>
    Effect.gen(function* () {
      const validatedProjectPath = yield* validateProjectPath(projectPath)
      if (!validatedProjectPath) return []
      const grants = yield* Effect.promise(() => listGrantsForProject(validatedProjectPath))
      return [...grants]
    }),
  )

  hostHandle('authorization-grants:grant', (_event, projectPath: string, key: unknown) =>
    grantProjectAuthorizationOperation(projectPath, key),
  )

  hostHandle('authorization-grants:revoke', (_event, projectPath: string, key: unknown) =>
    revokeProjectAuthorizationOperation(projectPath, key),
  )

  typedHandle('dialog:confirm', (_event, message: string, detail?: string) =>
    Effect.gen(function* () {
      const result = yield* Effect.promise(() =>
        showMessageBox(null, {
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
