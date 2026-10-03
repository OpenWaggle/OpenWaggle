import { safeDecodeUnknown } from '@shared/schema'
import { settingsUpdateSchema } from '@shared/schemas/settings'
import { parseSessionTitleModelSetting } from '@shared/session-title-model'
import { SupportedModelId } from '@shared/types/brand'
import type { Settings } from '@shared/types/settings'
import {
  type ExtensionPanelShortcutBindings,
  isMandatoryShortcutCommand,
  SHORTCUT_COMMANDS,
  type ShortcutBinding,
  type ShortcutBindings,
  type ShortcutCommand,
  type ShortcutRules,
  shortcutBindingKey,
  shortcutRulesFromBindings,
  shortcutRulesWithDefaults,
  shortcutScopesOverlap,
} from '@shared/types/shortcuts'
import { extensionPanelShortcutUpdateError } from '@shared/utils/extension-panel-shortcuts'
import * as Effect from 'effect/Effect'
import { createLogger } from '../logger'
import { ActiveProjectChangeService } from '../ports/active-project-change-service'
import { SettingsService } from '../services/settings-service'
import { validateProjectPath } from '../utils/project-path-validation'
import { resolveEffectiveAuthorizationMode } from './agent-authorization-mode'
import { grantPendingAuthorizationsWhereFullAccess } from './agent-loop-authorization-grants'
import { testCredentials } from './provider-test-service'
import { recordUsageStatisticsObservation } from './usage-statistics-recording'

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

  const owners = new Map<string, ShortcutCommand[]>()
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
    const owner = owners.get(key)?.find((existing) => shortcutScopesOverlap(command, existing))
    if (owner !== undefined)
      return { ok: false, error: `Shortcut ${key} is already assigned to ${owner}.` }
    owners.set(key, [...(owners.get(key) ?? []), command])
  }
  return { ok: true, value: candidate }
}

/**
 * Extension panel shortcuts share the conflict-free contract of the Shortcut registry: an update
 * may not give an extension panel a combination that a built-in rule, a reserved combination or
 * another extension panel already uses, in either direction (ADR 0043).
 */
function validateExtensionPanelShortcutUpdate(
  current: Settings,
  patch: {
    readonly shortcutRules?: ShortcutRules
    readonly shortcutBindings?: ShortcutBindings
    readonly extensionPanelShortcutBindings?: ExtensionPanelShortcutBindings
  },
) {
  const rules =
    patch.shortcutRules !== undefined
      ? shortcutRulesWithDefaults(patch.shortcutRules)
      : patch.shortcutBindings !== undefined
        ? shortcutRulesWithDefaults(shortcutRulesFromBindings(patch.shortcutBindings))
        : current.shortcutRules
  return extensionPanelShortcutUpdateError(
    { rules: current.shortcutRules, bindings: current.extensionPanelShortcutBindings },
    {
      rules,
      bindings: patch.extensionPanelShortcutBindings ?? current.extensionPanelShortcutBindings,
    },
  )
}

type ShortcutSettingsPatch = Pick<
  Partial<Settings>,
  'shortcutRules' | 'shortcutBindings' | 'extensionPanelShortcutBindings'
>

/** Built-in bindings and extension panel bindings are validated against the saved settings. */
function validateShortcutSettingsUpdate(patch: ShortcutSettingsPatch) {
  return Effect.gen(function* () {
    if (
      patch.shortcutBindings === undefined &&
      patch.shortcutRules === undefined &&
      patch.extensionPanelShortcutBindings === undefined
    ) {
      return { ok: true as const, shortcutBindings: undefined }
    }
    const current = yield* (yield* SettingsService).get()
    let shortcutBindings: ShortcutBindings | undefined
    if (patch.shortcutBindings !== undefined) {
      const validated = validateShortcutBindingsUpdate(
        current.shortcutBindings,
        patch.shortcutBindings,
      )
      if (!validated.ok) {
        logger.warn('Invalid shortcut bindings update', { error: validated.error })
        return { ok: false as const, error: validated.error }
      }
      shortcutBindings = validated.value
    }
    const error = validateExtensionPanelShortcutUpdate(current, {
      shortcutRules: patch.shortcutRules,
      shortcutBindings,
      extensionPanelShortcutBindings: patch.extensionPanelShortcutBindings,
    })
    if (error !== null) {
      logger.warn('Invalid extension panel shortcut update', { error })
      return { ok: false as const, error }
    }
    return { ok: true as const, shortcutBindings }
  })
}

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
    const shortcuts = yield* validateShortcutSettingsUpdate(result.data)
    if (!shortcuts.ok) {
      return { ok: false, error: shortcuts.error } satisfies { ok: false; error: string }
    }
    const shortcutBindings = shortcuts.shortcutBindings
    yield* settings.update({
      ...result.data,
      projectPath: result.data.projectPath !== undefined ? projectPathValidation.value : undefined,
      recentProjects,
      selectedModel:
        result.data.selectedModel !== undefined
          ? SupportedModelId(result.data.selectedModel)
          : undefined,
      sessionTitleModel:
        result.data.sessionTitleModel !== undefined
          ? (parseSessionTitleModelSetting(result.data.sessionTitleModel) ?? undefined)
          : undefined,
      favoriteModels: result.data.favoriteModels?.map(SupportedModelId),
      enabledModels: result.data.enabledModels?.map(SupportedModelId),
      shortcutBindings,
    })
    if (result.data.projectPath !== undefined) {
      if (projectPathValidation.value !== null) {
        yield* recordUsageStatisticsObservation({ kind: 'project-opened' })
      }
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
