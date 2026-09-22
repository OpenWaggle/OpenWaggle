import { safeDecodeUnknown } from '@shared/schema'
import { projectPreferencesUpdateSchema } from '@shared/schemas/validation'
import { isAgentAuthorizationMode } from '@shared/types/agent-authorization'
import { THINKING_LEVELS } from '@shared/types/settings'
import { includes } from '@shared/utils/validation'
import * as Effect from 'effect/Effect'
import {
  getProjectPreferencesStrict,
  type ProjectPreferencesUpdate,
  setProjectPreferences,
} from '../config/project-config'
import { SettingsService } from '../services/settings-service'
import { validateProjectPath } from '../utils/project-path-validation'
import { resolveEffectiveAuthorizationMode } from './agent-authorization-mode'
import { grantPendingAuthorizationsWhereFullAccess } from './agent-loop-authorization-grants'

function isCanonicalModelRef(value: string) {
  const trimmed = value.trim()
  return !!trimmed && !trimmed.startsWith('/') && !trimmed.endsWith('/') && trimmed.includes('/')
}

function validatePreferenceField<T>(
  value: T | null | undefined,
  isValid: (candidate: T) => boolean,
  message: string,
) {
  if (value === undefined || value === null) return null
  return isValid(value) ? null : message
}

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

  return Effect.succeed<{
    model: string | null | undefined
    filePreferences: ProjectPreferencesUpdate
  }>({
    model,
    filePreferences: {
      ...(thinkingLevel !== undefined ? { thinkingLevel } : {}),
      ...(authorizationMode !== undefined ? { authorizationMode } : {}),
    },
  })
}

/**
 * Reads one project's preference overrides as the wire payload.
 *
 * The selected model lives in the app's SQLite settings store, keyed by project path — never in the
 * repo-local project settings file. A model still present in that file is a legacy value kept as
 * fallback until the DB has its own entry, which then wins.
 */
export function getProjectPreferencesOperation(rawProjectPath: unknown) {
  return Effect.gen(function* () {
    const projectPath = yield* validateProjectPath(
      typeof rawProjectPath === 'string' ? rawProjectPath : null,
    )
    if (!projectPath) return null
    const prefs = yield* Effect.promise(() => getProjectPreferencesStrict(projectPath))
    const settings = yield* SettingsService
    const dbModel = (yield* settings.get()).selectedModelsByProject[projectPath]
    if (!prefs && !dbModel) return null
    return { ...prefs, ...(dbModel ? { model: dbModel } : {}) }
  })
}

/**
 * Persists one project preference write.
 *
 * The selected model never goes into the project settings file: that file lives inside the
 * repository, so committing a personal model pick would leak machine-specific provider config into
 * shared source. The model therefore lands in the app's SQLite settings store instead, keyed by
 * project path; only thinkingLevel and authorizationMode remain repo-local.
 */
export function setProjectPreferencesOperation(rawProjectPath: unknown, rawPreferences: unknown) {
  return Effect.gen(function* () {
    const projectPath = yield* validateProjectPath(
      typeof rawProjectPath === 'string' ? rawProjectPath : null,
    )
    if (!projectPath) return yield* Effect.fail(new Error('Project path is required.'))
    const { model, filePreferences } = yield* validateProjectPreferences(rawPreferences)

    if (model !== undefined) {
      const settings = yield* SettingsService
      if (settings.setProjectModel) {
        // Dedicated writer: read-modify-write happens inside the settings write queue, so
        // concurrent project preference writes cannot lose each other's map entries.
        yield* settings.setProjectModel(projectPath, model)
      } else {
        const current = yield* settings.get()
        const { [projectPath]: _current, ...rest } = current.selectedModelsByProject
        yield* settings.update({
          selectedModelsByProject: model === null ? rest : { ...rest, [projectPath]: model },
        })
      }
    }

    if (
      filePreferences.thinkingLevel !== undefined ||
      filePreferences.authorizationMode !== undefined
    ) {
      yield* Effect.promise(() => setProjectPreferences(projectPath, filePreferences))
    }

    if (filePreferences.authorizationMode !== undefined) {
      yield* Effect.promise(() =>
        grantPendingAuthorizationsWhereFullAccess(resolveEffectiveAuthorizationMode),
      )
    }
  })
}
