import { safeDecodeUnknown } from '@shared/schema'
import {
  authorizationScopeKeySchema,
  projectPreferencesUpdateSchema,
} from '@shared/schemas/validation'
import { isAgentAuthorizationMode } from '@shared/types/agent-authorization'
import { THINKING_LEVELS } from '@shared/types/settings'
import { includes } from '@shared/utils/validation'
import * as Effect from 'effect/Effect'
import type { OpenDialogOptions } from 'electron'
import {
  grantForProject,
  listGrantsForProject,
  revokeForProject,
} from '../application/agent-authorization-grants'
import { resolveEffectiveAuthorizationMode } from '../application/agent-authorization-mode'
import { grantPendingAuthorizationsWhereFullAccess } from '../application/agent-loop-interaction-broker'
import {
  getProjectPreferences,
  type ProjectPreferencesUpdate,
  setProjectPreferences,
} from '../config/project-config'
import { browserWindowFromWebContents, showMessageBox, showOpenDialog } from '../desktop-ui'
import { validateProjectPath } from './project-path-validation'
import { typedHandle } from './typed-ipc'

function createProjectFolderDialogOptions(): OpenDialogOptions {
  return {
    properties: ['openDirectory'],
    title: 'Select Project Folder',
  }
}

function isCanonicalModelRef(value: string) {
  const trimmed = value.trim()
  if (!trimmed || trimmed.startsWith('/') || trimmed.endsWith('/')) {
    return false
  }
  return trimmed.includes('/')
}

/**
 * Checks one preference field.
 *
 * `undefined` means the caller is not touching the field, `null` means delete it, so only a
 * non-null value has anything to validate.
 */
function validatePreferenceField<T>(
  value: T | null | undefined,
  isValid: (candidate: T) => boolean,
  message: string,
) {
  if (value === undefined || value === null) return null
  return isValid(value) ? null : message
}

/**
 * Validates a preference write.
 *
 * `null` is valid for every field and means "delete this key so the project inherits again".
 */
function validateProjectPreferences(preferences: unknown) {
  const result = safeDecodeUnknown(projectPreferencesUpdateSchema, preferences)
  if (!result.success) {
    return Effect.fail(new Error(`Invalid project preferences: ${result.issues.join('; ')}`))
  }

  const model = result.data.model === null ? null : result.data.model?.trim()
  const { thinkingLevel, authorizationMode } = result.data

  const failure =
    validatePreferenceField(
      model,
      isCanonicalModelRef,
      'Project preference model must be a provider/model ref.',
    ) ??
    validatePreferenceField(
      thinkingLevel,
      (level) => includes(THINKING_LEVELS, level),
      'Project preference thinking level is invalid.',
    ) ??
    validatePreferenceField(
      authorizationMode,
      isAgentAuthorizationMode,
      'Project preference authorization mode is invalid.',
    )
  if (failure) return Effect.fail(new Error(failure))

  const validatedPreferences: ProjectPreferencesUpdate = {
    ...(model !== undefined ? { model } : {}),
    ...(thinkingLevel !== undefined ? { thinkingLevel } : {}),
    ...(authorizationMode !== undefined ? { authorizationMode } : {}),
  }
  return Effect.succeed(validatedPreferences)
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

  typedHandle('project-config:set-preferences', (_event, projectPath: string, preferences) =>
    Effect.gen(function* () {
      const validatedProjectPath = yield* validateProjectPath(projectPath)
      if (!validatedProjectPath) {
        return yield* Effect.fail(new Error('Project path is required.'))
      }
      const validatedPreferences = yield* validateProjectPreferences(preferences)
      yield* Effect.promise(() => setProjectPreferences(validatedProjectPath, validatedPreferences))

      // A project default can reveal full access for sessions that hold no override, so the prompt
      // already on screen has to be settled too.
      if (validatedPreferences.authorizationMode !== undefined) {
        yield* Effect.promise(() =>
          grantPendingAuthorizationsWhereFullAccess(resolveEffectiveAuthorizationMode),
        )
      }
    }),
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
