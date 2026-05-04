import { Schema, safeDecodeUnknown } from '@shared/schema'
import { SupportedModelId } from '@shared/types/brand'
import type { SessionTreeFilterMode } from '@shared/types/session'
import { THINKING_LEVELS } from '@shared/types/settings'
import * as Effect from 'effect/Effect'
import { testCredentials } from '../application/provider-test-service'
import { createLogger } from '../logger'
import { SessionTreePreferencesService } from '../ports/session-tree-preferences-service'
import { SettingsService } from '../services/settings-service'
import { validateProjectPath } from './project-path-validation'
import { typedHandle } from './typed-ipc'

const logger = createLogger('ipc-settings')

function isString(value: string | undefined): value is string {
  return value !== undefined
}

function validateSettingsProjectPath(projectPath: string | null | undefined) {
  return validateProjectPath(projectPath).pipe(
    Effect.map((validated) => ({ ok: true as const, value: validated ?? null })),
    Effect.catchAll((error) =>
      Effect.succeed({
        ok: false as const,
        error: error instanceof Error ? error.message : String(error),
      }),
    ),
  )
}

function validateRecentProjectPaths(projects: readonly string[] | undefined) {
  if (!projects) {
    return Effect.succeed(undefined)
  }

  return Effect.forEach(projects, (projectPath) =>
    validateProjectPath(projectPath).pipe(
      Effect.catchAll((error) =>
        Effect.sync(() => {
          logger.warn('Dropping invalid recent project path', {
            projectPath,
            error: error instanceof Error ? error.message : String(error),
          })
          return undefined
        }),
      ),
    ),
  ).pipe(Effect.map((validatedProjects) => validatedProjects.filter(isString)))
}

function isTreeFilterMode(value: unknown): value is SessionTreeFilterMode {
  return (
    value === 'default' ||
    value === 'no-tools' ||
    value === 'user-only' ||
    value === 'labeled-only' ||
    value === 'all'
  )
}

function validateTreeFilterMode(value: unknown): Effect.Effect<SessionTreeFilterMode, Error> {
  return isTreeFilterMode(value)
    ? Effect.succeed(value)
    : Effect.fail(new Error('Invalid tree filter mode'))
}

const settingsUpdateSchema = Schema.Struct({
  selectedModel: Schema.optional(Schema.String),
  favoriteModels: Schema.optional(Schema.mutable(Schema.Array(Schema.String))),
  enabledModels: Schema.optional(Schema.mutable(Schema.Array(Schema.String))),
  projectPath: Schema.optional(Schema.NullOr(Schema.String)),
  thinkingLevel: Schema.optional(Schema.Literal(...THINKING_LEVELS)),
  recentProjects: Schema.optional(Schema.mutable(Schema.Array(Schema.String))),
  skillTogglesByProject: Schema.optional(
    Schema.mutable(
      Schema.Record({
        key: Schema.String,
        value: Schema.mutable(
          Schema.Record({
            key: Schema.String,
            value: Schema.Boolean,
          }),
        ),
      }),
    ),
  ),
  projectDisplayNames: Schema.optional(
    Schema.mutable(
      Schema.Record({
        key: Schema.String,
        value: Schema.String,
      }),
    ),
  ),
})

export function registerSettingsHandlers(): void {
  typedHandle('settings:get', () =>
    Effect.gen(function* () {
      const settings = yield* SettingsService
      return yield* settings.get()
    }),
  )

  typedHandle('settings:update', (_event, raw: unknown) =>
    Effect.gen(function* () {
      const result = safeDecodeUnknown(settingsUpdateSchema, raw)
      if (!result.success) {
        const error = result.issues.join('; ')
        logger.warn('Invalid settings update payload', { error })
        return { ok: false, error } satisfies { ok: false; error: string }
      }

      const projectPathValidation = yield* validateSettingsProjectPath(result.data.projectPath)
      if (!projectPathValidation.ok) {
        logger.warn('Invalid settings project path', { error: projectPathValidation.error })
        return { ok: false, error: projectPathValidation.error } satisfies {
          ok: false
          error: string
        }
      }

      const recentProjects = yield* validateRecentProjectPaths(result.data.recentProjects)

      const settings = yield* SettingsService
      yield* settings.update({
        ...result.data,
        projectPath:
          result.data.projectPath !== undefined ? projectPathValidation.value : undefined,
        recentProjects,
        selectedModel:
          result.data.selectedModel !== undefined
            ? SupportedModelId(result.data.selectedModel)
            : undefined,
        favoriteModels: result.data.favoriteModels?.map(SupportedModelId),
        enabledModels: result.data.enabledModels?.map(SupportedModelId),
      })
      return { ok: true } satisfies { ok: true }
    }),
  )

  typedHandle('settings:set-enabled-models', (_event, models: unknown) =>
    Effect.gen(function* () {
      if (!Array.isArray(models) || !models.every((m) => typeof m === 'string')) {
        logger.warn('Invalid enabled models payload', { models })
        return undefined
      }
      const settings = yield* SettingsService
      yield* settings.update({ enabledModels: models.map(SupportedModelId) })
      return undefined
    }),
  )

  typedHandle('pi-settings:get-tree-filter-mode', (_event, projectPath?: string | null) =>
    Effect.gen(function* () {
      const validatedProjectPath = yield* validateProjectPath(projectPath)
      const preferences = yield* SessionTreePreferencesService
      return yield* preferences.getTreeFilterMode(validatedProjectPath)
    }),
  )

  typedHandle(
    'pi-settings:set-tree-filter-mode',
    (_event, mode: unknown, projectPath?: string | null) =>
      Effect.gen(function* () {
        const validatedMode = yield* validateTreeFilterMode(mode)
        const validatedProjectPath = yield* validateProjectPath(projectPath)
        const preferences = yield* SessionTreePreferencesService
        return yield* preferences.setTreeFilterMode(validatedMode, validatedProjectPath)
      }),
  )

  typedHandle('pi-settings:get-branch-summary-skip-prompt', (_event, projectPath?: string | null) =>
    Effect.gen(function* () {
      const validatedProjectPath = yield* validateProjectPath(projectPath)
      const preferences = yield* SessionTreePreferencesService
      return yield* preferences.getBranchSummarySkipPrompt(validatedProjectPath)
    }),
  )

  typedHandle(
    'settings:test-api-key',
    (_event, provider: string, apiKey: string, projectPath?: string | null) =>
      Effect.gen(function* () {
        const validatedProjectPath = yield* validateProjectPath(projectPath)
        return yield* testCredentials(provider, apiKey, validatedProjectPath)
      }),
  )
}
