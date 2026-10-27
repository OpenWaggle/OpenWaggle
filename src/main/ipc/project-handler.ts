import fs from 'node:fs/promises'
import * as Effect from 'effect/Effect'
import type { OpenDialogOptions } from 'electron'
import { listGrantsForProject } from '../application/agent-authorization-grants'
import { browserWindowFromWebContents, showMessageBox, showOpenDialog } from '../desktop-ui'
import { takeOpenProjectRequest } from '../open-project-requests'
import { takeOpenSessionLinkRequest } from '../session-link-requests'
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

      const pickedPath = result.filePaths[0] ?? null
      if (!pickedPath) return null
      // Store the canonical path so later project-model reads, writes, and removals all key the
      // same identity even when the user picked the folder through a symlink.
      return yield* Effect.promise(() => fs.realpath(pickedPath).catch(() => pickedPath))
    }),
  )

  typedHandle('project:take-open-request', () => Effect.sync(takeOpenProjectRequest))
  typedHandle('app:take-open-session-link-request', () => Effect.sync(takeOpenSessionLinkRequest))

  hostHandle('project-config:get-preferences')

  hostHandle('project-config:set-preferences')

  hostHandle('project-config:remove-project-model')

  typedHandle('authorization-grants:list', (_event, projectPath: string) =>
    Effect.gen(function* () {
      const validatedProjectPath = yield* validateProjectPath(projectPath)
      if (!validatedProjectPath) return []
      const grants = yield* Effect.promise(() => listGrantsForProject(validatedProjectPath))
      return [...grants]
    }),
  )

  hostHandle('authorization-grants:grant')

  hostHandle('authorization-grants:revoke')

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
