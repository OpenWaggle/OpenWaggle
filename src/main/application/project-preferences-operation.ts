import { safeDecodeUnknown } from '@shared/schema'
import { projectPreferencesUpdateSchema } from '@shared/schemas/validation'
import { isAgentAuthorizationMode } from '@shared/types/agent-authorization'
import { THINKING_LEVELS } from '@shared/types/settings'
import { includes } from '@shared/utils/validation'
import * as Effect from 'effect/Effect'
import { type ProjectPreferencesUpdate, setProjectPreferences } from '../config/project-config'
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

  return Effect.succeed<ProjectPreferencesUpdate>({
    ...(model !== undefined ? { model } : {}),
    ...(thinkingLevel !== undefined ? { thinkingLevel } : {}),
    ...(authorizationMode !== undefined ? { authorizationMode } : {}),
  })
}

export function setProjectPreferencesOperation(rawProjectPath: unknown, rawPreferences: unknown) {
  return Effect.gen(function* () {
    const projectPath = yield* validateProjectPath(
      typeof rawProjectPath === 'string' ? rawProjectPath : null,
    )
    if (!projectPath) return yield* Effect.fail(new Error('Project path is required.'))
    const preferences = yield* validateProjectPreferences(rawPreferences)
    yield* Effect.promise(() => setProjectPreferences(projectPath, preferences))

    if (preferences.authorizationMode !== undefined) {
      yield* Effect.promise(() =>
        grantPendingAuthorizationsWhereFullAccess(resolveEffectiveAuthorizationMode),
      )
    }
  })
}
