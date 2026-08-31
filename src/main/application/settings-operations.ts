import { Schema, safeDecodeUnknown } from '@shared/schema'
import { AGENT_AUTHORIZATION_MODES } from '@shared/types/agent-authorization'
import { SupportedModelId } from '@shared/types/brand'
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
import { createLogger } from '../logger'
import { ActiveProjectChangeService } from '../ports/active-project-change-service'
import { SettingsService } from '../services/settings-service'
import { validateProjectPath } from '../utils/project-path-validation'
import { resolveEffectiveAuthorizationMode } from './agent-authorization-mode'
import { grantPendingAuthorizationsWhereFullAccess } from './agent-loop-authorization-grants'
import { testCredentials } from './provider-test-service'

const logger = createLogger('ipc-settings')
const MAX_SHORTCUT_KEY_LENGTH = 20
const positiveIntegerSchema = Schema.Number.pipe(Schema.int(), Schema.positive())
const nonNegativeIntegerSchema = Schema.Number.pipe(Schema.int(), Schema.nonNegative())

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
  if (!projects) return Effect.succeed(undefined)
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
    if (owner) return { ok: false, error: `Shortcut ${key} is already assigned to ${owner}.` }
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
  recentProjects: Schema.optional(Schema.mutable(Schema.Array(Schema.String))),
  skillTogglesByProject: Schema.optional(
    Schema.mutable(
      Schema.Record({
        key: Schema.String,
        value: Schema.mutable(Schema.Record({ key: Schema.String, value: Schema.Boolean })),
      }),
    ),
  ),
  projectDisplayNames: Schema.optional(
    Schema.mutable(Schema.Record({ key: Schema.String, value: Schema.String })),
  ),
  defaultAuthorizationMode: Schema.optional(Schema.Literal(...AGENT_AUTHORIZATION_MODES)),
  sessionHostParentConcurrencyLimit: Schema.optional(positiveIntegerSchema),
  sessionHostParentConcurrencyLimitsByProject: Schema.optional(
    Schema.mutable(Schema.Record({ key: Schema.String, value: positiveIntegerSchema })),
  ),
  sessionHostRunCeiling: Schema.optional(positiveIntegerSchema),
  sessionHostIdleGracePeriodMs: Schema.optional(nonNegativeIntegerSchema),
  multiAgentEnabled: Schema.optional(Schema.Boolean),
  multiAgentEnabledByProject: Schema.optional(
    Schema.mutable(Schema.Record({ key: Schema.String, value: Schema.Boolean })),
  ),
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

export function getSettingsOperation() {
  return SettingsService.pipe(Effect.flatMap((settings) => settings.get()))
}

export function updateSettingsOperation(raw: unknown) {
  return Effect.gen(function* () {
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
      projectPath: result.data.projectPath !== undefined ? projectPathValidation.value : undefined,
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
    if (result.data.defaultAuthorizationMode !== undefined) {
      yield* Effect.promise(() =>
        grantPendingAuthorizationsWhereFullAccess(resolveEffectiveAuthorizationMode),
      )
    }
    return { ok: true } satisfies { ok: true }
  })
}

export function setEnabledModelsOperation(models: unknown) {
  return Effect.gen(function* () {
    if (!Array.isArray(models) || !models.every((model) => typeof model === 'string')) {
      logger.warn('Invalid enabled models payload', { models })
      return undefined
    }
    const settings = yield* SettingsService
    yield* settings.update({ enabledModels: models.map(SupportedModelId) })
    return undefined
  })
}

export function testApiKeyOperation(provider: string, apiKey: string, projectPath?: string | null) {
  return Effect.gen(function* () {
    const validatedProjectPath = yield* validateProjectPath(projectPath)
    return yield* testCredentials(provider, apiKey, validatedProjectPath)
  })
}
