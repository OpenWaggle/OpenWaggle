import { safeDecodeUnknown } from '@shared/schema'
import { projectPreferencesSchema } from '@shared/schemas/validation'
import { THINKING_LEVELS } from '@shared/types/settings'
import { includes } from '@shared/utils/validation'
import * as Effect from 'effect/Effect'
import { BrowserWindow, dialog, type OpenDialogOptions } from 'electron'
import {
  getProjectPreferences,
  type ProjectPreferences,
  setProjectPreferences,
} from '../config/project-config'
import { validateProjectPath } from './project-path-validation'
import { typedHandle } from './typed-ipc'

function createProjectFolderDialogOptions(): OpenDialogOptions {
  return {
    properties: ['openDirectory'],
    title: 'Select Project Folder',
  }
}

function isCanonicalModelRef(value: string): boolean {
  const trimmed = value.trim()
  if (!trimmed || trimmed.startsWith('/') || trimmed.endsWith('/')) {
    return false
  }
  return trimmed.includes('/')
}

function validateProjectPreferences(
  preferences: unknown,
): Effect.Effect<ProjectPreferences, Error> {
  const result = safeDecodeUnknown(projectPreferencesSchema, preferences)
  if (!result.success) {
    return Effect.fail(new Error(`Invalid project preferences: ${result.issues.join('; ')}`))
  }

  const model = result.data.model?.trim()
  if (model !== undefined && !isCanonicalModelRef(model)) {
    return Effect.fail(new Error('Project preference model must be a provider/model ref.'))
  }

  const { thinkingLevel } = result.data
  if (thinkingLevel !== undefined && !includes(THINKING_LEVELS, thinkingLevel)) {
    return Effect.fail(new Error('Project preference thinking level is invalid.'))
  }

  const validatedPreferences: ProjectPreferences = {
    ...(model !== undefined ? { model } : {}),
    ...(thinkingLevel !== undefined ? { thinkingLevel } : {}),
  }
  return Effect.succeed(validatedPreferences)
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

  typedHandle('project-config:set-preferences', (_event, projectPath: string, preferences) =>
    Effect.gen(function* () {
      const validatedProjectPath = yield* validateProjectPath(projectPath)
      if (!validatedProjectPath) {
        return yield* Effect.fail(new Error('Project path is required.'))
      }
      const validatedPreferences = yield* validateProjectPreferences(preferences)
      yield* Effect.promise(() => setProjectPreferences(validatedProjectPath, validatedPreferences))
    }),
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
