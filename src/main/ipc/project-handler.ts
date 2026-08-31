import { safeDecodeUnknown } from '@shared/schema'
import { authorizationScopeKeySchema } from '@shared/schemas/validation'
import * as Effect from 'effect/Effect'
import type { OpenDialogOptions } from 'electron'
import {
  grantForProject,
  listGrantsForProject,
  revokeForProject,
} from '../application/agent-authorization-grants'
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

function validateAuthorizationScopeKey(key: unknown) {
  const result = safeDecodeUnknown(authorizationScopeKeySchema, key)
  if (!result.success) {
    return Effect.fail(new Error(`Invalid authorization scope key: ${result.issues.join('; ')}`))
  }

  const requester = result.data.requester.trim()
  if (!requester) {
    return Effect.fail(new Error('Authorization scope key requires a requester.'))
  }

  // Identity, so an empty one would make every grant for that capability look alike.
  const requesterId = result.data.requesterId.trim()
  if (!requesterId) {
    return Effect.fail(new Error('Authorization scope key requires a requester id.'))
  }

  const resource = result.data.resource?.trim()
  return Effect.succeed({
    requester,
    requesterId,
    capability: result.data.capability,
    ...(resource ? { resource } : {}),
  })
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

  typedHandle('authorization-grants:grant', (_event, projectPath: string, key: unknown) =>
    Effect.gen(function* () {
      const validatedProjectPath = yield* validateProjectPath(projectPath)
      if (!validatedProjectPath) {
        return yield* Effect.fail(new Error('Project path is required.'))
      }
      const validatedKey = yield* validateAuthorizationScopeKey(key)
      yield* Effect.promise(() => grantForProject(validatedProjectPath, validatedKey))
    }),
  )

  typedHandle('authorization-grants:revoke', (_event, projectPath: string, key: unknown) =>
    Effect.gen(function* () {
      const validatedProjectPath = yield* validateProjectPath(projectPath)
      if (!validatedProjectPath) {
        return yield* Effect.fail(new Error('Project path is required.'))
      }
      const validatedKey = yield* validateAuthorizationScopeKey(key)
      yield* Effect.promise(() => revokeForProject(validatedProjectPath, validatedKey))
    }),
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
