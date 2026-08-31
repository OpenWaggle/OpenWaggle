import { isMatching, P } from '@diegogbrisa/ts-match'
import { PERCENT_BASE } from '@shared/constants/math'
import { Schema, safeDecodeUnknown } from '@shared/schema'
import { AGENT_AUTHORIZATION_MODES } from '@shared/types/agent-authorization'
import { SupportedModelId } from '@shared/types/brand'
import type { SessionTreeFilterMode } from '@shared/types/session'
import { THINKING_LEVELS } from '@shared/types/settings'
import {
  isMandatoryShortcutCommand,
  SHORTCUT_COMMANDS,
  type ShortcutBinding,
  type ShortcutBindings,
  type ShortcutCommand,
  shortcutBindingKey,
} from '@shared/types/shortcuts'
import * as Effect from 'effect/Effect'
import { resolveEffectiveAuthorizationMode } from '../application/agent-authorization-mode'
import { grantPendingAuthorizationsWhereFullAccess } from '../application/agent-loop-interaction-broker'
import { testCredentials } from '../application/provider-test-service'
import { createLogger } from '../logger'
import { ActiveProjectChangeService } from '../ports/active-project-change-service'
import { SessionTreePreferencesService } from '../ports/session-tree-preferences-service'
import { SettingsService } from '../services/settings-service'
import { validateProjectPath } from './project-path-validation'
import { typedHandle } from './typed-ipc'

const logger = createLogger('ipc-settings')
const MAX_SHORTCUT_KEY_LENGTH = 20

function isString(value: string | undefined) {
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
  return isMatching(P.union('default', 'no-tools', 'user-only', 'labeled-only', 'all'), value)
}

function validateTreeFilterMode(value: unknown) {
  return isTreeFilterMode(value)
    ? Effect.succeed(value)
    : Effect.fail(new Error('Invalid tree filter mode'))
}

type ShortcutBindingsPatch = Readonly<Partial<Record<ShortcutCommand, ShortcutBinding | null>>>

function validateShortcutBindingsUpdate(
  current: ShortcutBindings,
  patch: ShortcutBindingsPatch,
):
  | { readonly ok: true; readonly value: ShortcutBindings }
  | { readonly ok: false; readonly error: string } {
  const candidate: Record<ShortcutCommand, ShortcutBinding | null> = { ...current }
  for (const command of SHORTCUT_COMMANDS) {
    if (Object.hasOwn(patch, command)) candidate[command] = patch[command] ?? null
  }

  const owners = new Map<string, ShortcutCommand>()
  for (const command of SHORTCUT_COMMANDS) {
    const binding = candidate[command]
    if (!binding) {
      if (isMandatoryShortcutCommand(command)) {
        return { ok: false, error: `Shortcut ${command} must stay assigned.` }
      }
      continue
    }
    if (!binding.key.trim() || binding.key.trim().length > MAX_SHORTCUT_KEY_LENGTH) {
      return { ok: false, error: `Shortcut ${command} has an invalid key.` }
    }

    const key = shortcutBindingKey(binding)
    const owner = owners.get(key)
    if (owner) {
      return { ok: false, error: `Shortcut ${key} is already assigned to ${owner}.` }
    }
    owners.set(key, command)
  }

  return { ok: true, value: candidate }
}

const settingsUpdateSchema = Schema.Struct({
  selectedModel: Schema.optional(Schema.String),
  favoriteModels: Schema.optional(Schema.mutable(Schema.Array(Schema.String))),
  enabledModels: Schema.optional(Schema.mutable(Schema.Array(Schema.String))),
  projectPath: Schema.optional(Schema.NullOr(Schema.String)),
  thinkingLevel: Schema.optional(Schema.Literal(...THINKING_LEVELS)),
  compactionThresholdPercent: Schema.optional(
    Schema.Number.pipe(Schema.int(), Schema.between(1, PERCENT_BASE)),
  ),
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
  defaultAuthorizationMode: Schema.optional(Schema.Literal(...AGENT_AUTHORIZATION_MODES)),
  shortcutBindings: Schema.optional(
    Schema.mutable(
      Schema.Record({
        key: Schema.Literal(...SHORTCUT_COMMANDS),
        value: Schema.Union(
          Schema.Struct({
            key: Schema.String,
            mod: Schema.optional(Schema.Boolean),
            ctrl: Schema.optional(Schema.Boolean),
            shift: Schema.optional(Schema.Boolean),
            alt: Schema.optional(Schema.Boolean),
            meta: Schema.optional(Schema.Boolean),
          }),
          Schema.Null,
        ),
      }),
    ),
  ),
})

function registerSettingsCrudHandlers() {
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
      let shortcutBindings: ShortcutBindings | undefined
      if (result.data.shortcutBindings !== undefined) {
        const current = yield* settings.get()
        const validated = validateShortcutBindingsUpdate(
          current.shortcutBindings,
          result.data.shortcutBindings,
        )
        if (!validated.ok) {
          logger.warn('Invalid shortcut bindings update', { error: validated.error })
          return { ok: false, error: validated.error } satisfies { ok: false; error: string }
        }
        shortcutBindings = validated.value
      }
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
        shortcutBindings,
      })
      if (result.data.projectPath !== undefined) {
        const projectChanges = yield* ActiveProjectChangeService
        yield* projectChanges.reconcileTrustedMainExtensions(projectPathValidation.value)
      }
      // The global default can reveal full access for sessions that hold no override of their own, so
      // a prompt already on screen has to be settled rather than left parked.
      if (result.data.defaultAuthorizationMode !== undefined) {
        yield* Effect.promise(() =>
          grantPendingAuthorizationsWhereFullAccess(resolveEffectiveAuthorizationMode),
        )
      }
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
}

function registerTreePreferenceHandlers() {
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
}

function registerSettingsUtilityHandlers() {
  typedHandle(
    'settings:test-api-key',
    (_event, provider: string, apiKey: string, projectPath?: string | null) =>
      Effect.gen(function* () {
        const validatedProjectPath = yield* validateProjectPath(projectPath)
        return yield* testCredentials(provider, apiKey, validatedProjectPath)
      }),
  )
}

export function registerSettingsHandlers(): void {
  registerSettingsCrudHandlers()
  registerTreePreferenceHandlers()
  registerSettingsUtilityHandlers()
}
