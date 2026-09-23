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
import { SettingsService, type SettingsServiceShape } from '../services/settings-service'
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
    const modelByProject = (yield* settings.get()).selectedModelsByProject
    // Presence, not truthiness: an empty-string tombstone means the user explicitly cleared this
    // project's model, and it must suppress a legacy file value rather than fall back to it.
    const hasDbEntry = Object.hasOwn(modelByProject, projectPath)
    const dbModel = modelByProject[projectPath]
    if (!prefs && !hasDbEntry) return null
    if (hasDbEntry && !dbModel) {
      const { model: _legacy, ...prefsWithoutModel } = prefs ?? {}
      return Object.keys(prefsWithoutModel).length > 0 ? prefsWithoutModel : null
    }
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
 *
 * Legacy handling: upgraded projects may still carry a `model` in the settings file. The file
 * writer strips it on every write, so before any strip this operation first makes the DB own the
 * value — an explicit write wins, otherwise the legacy value is migrated with an atomic
 * insert-if-absent write so it can never overwrite a newer explicit choice. Any explicit model
 * write (set or clear) against a file that still carries a legacy value also rewrites the file so
 * the repo sheds the stale value, and a clear leaves an empty-string tombstone in the DB that
 * suppresses the legacy fallback on read.
 */
export function setProjectPreferencesOperation(rawProjectPath: unknown, rawPreferences: unknown) {
  return Effect.gen(function* () {
    const projectPath = yield* validateProjectPath(
      typeof rawProjectPath === 'string' ? rawProjectPath : null,
    )
    if (!projectPath) return yield* Effect.fail(new Error('Project path is required.'))
    const { model, filePreferences } = yield* validateProjectPreferences(rawPreferences)
    const filePrefs = yield* Effect.promise(() => getProjectPreferencesStrict(projectPath))
    const settings = yield* SettingsService

    if (model !== undefined) {
      yield* writeProjectModel(settings, projectPath, model)
    }
    if (model === undefined && filePrefs?.model !== undefined) {
      // An unrelated file-backed write strips the legacy model below. Migrate it first so the
      // user's override survives; the insert-if-absent writer runs inside the settings write
      // queue, so it can never overwrite a newer explicit model choice.
      yield* migrateProjectModel(settings, projectPath, filePrefs.model)
    }

    // The file writer strips any legacy model, so an explicit model write against a file that
    // still carries one must rewrite it — a model-only set would otherwise leave the stale value
    // committed in the repo. Projects without a legacy file model only touch the DB.
    const rewritesLegacyFileModel = model !== undefined && filePrefs?.model !== undefined
    if (
      rewritesLegacyFileModel ||
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

    // Renderer mirrors (e.g. the per-project model map) must key by the canonical path this write
    // was stored under, not the caller-spelled alias, or later full-map writes would clobber it.
    return projectPath
  })
}

function migrateProjectModel(settings: SettingsServiceShape, projectPath: string, model: string) {
  if (settings.migrateProjectModel) {
    return settings.migrateProjectModel(projectPath, model)
  }
  // Fallback for service shapes without the atomic writer (test fakes).
  return Effect.gen(function* () {
    const current = yield* settings.get()
    if (Object.hasOwn(current.selectedModelsByProject, projectPath)) return false
    yield* writeProjectModel(settings, projectPath, model)
    return true
  })
}

function writeProjectModel(
  settings: SettingsServiceShape,
  projectPath: string,
  model: string | null,
) {
  if (settings.setProjectModel) {
    // Dedicated writer: read-modify-write happens inside the settings write queue, so
    // concurrent project preference writes cannot lose each other's map entries.
    return settings.setProjectModel(projectPath, model)
  }
  return Effect.gen(function* () {
    const current = yield* settings.get()
    yield* settings.update({
      selectedModelsByProject: {
        ...current.selectedModelsByProject,
        [projectPath]: model === null ? '' : model,
      },
    })
  })
}
