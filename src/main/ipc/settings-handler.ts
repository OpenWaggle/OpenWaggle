import { isMatching, P } from '@diegogbrisa/ts-match'
import type { SessionTreeFilterMode } from '@shared/types/session'
import * as Effect from 'effect/Effect'
import {
  getSettingsOperation,
  setEnabledModelsOperation,
  testApiKeyOperation,
  updateSettingsOperation,
} from '../application/settings-operations'
import { SessionTreePreferencesService } from '../ports/session-tree-preferences-service'
import { createAppCliShimService } from '../services/cli-shim-service'
import { validateProjectPath } from './project-path-validation'
import { hostHandle, typedHandle } from './typed-ipc'

function isTreeFilterMode(value: unknown): value is SessionTreeFilterMode {
  return isMatching(P.union('default', 'no-tools', 'user-only', 'labeled-only', 'all'), value)
}

function validateTreeFilterMode(value: unknown) {
  return isTreeFilterMode(value)
    ? Effect.succeed(value)
    : Effect.fail(new Error('Invalid tree filter mode'))
}

function registerSettingsCrudHandlers() {
  hostHandle('settings:get', () => getSettingsOperation())
  hostHandle('settings:update', (_event, raw: unknown) => updateSettingsOperation(raw))
  hostHandle('settings:set-enabled-models', (_event, models: unknown) =>
    setEnabledModelsOperation(models),
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
  typedHandle('cli-shim:get-status', () =>
    Effect.tryPromise(() => createAppCliShimService().status()),
  )
  typedHandle('cli-shim:install', () =>
    Effect.tryPromise(() => createAppCliShimService().install()),
  )
  typedHandle('cli-shim:remove', () => Effect.tryPromise(() => createAppCliShimService().remove()))
  hostHandle(
    'settings:test-api-key',
    (_event, provider: string, apiKey: string, projectPath?: string | null) =>
      testApiKeyOperation(provider, apiKey, projectPath),
  )
}

export function registerSettingsHandlers(): void {
  registerSettingsCrudHandlers()
  registerTreePreferenceHandlers()
  registerSettingsUtilityHandlers()
}
