import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import type { ExtensionBrokerTransport } from '@shared/extension-sdk-core'
import * as Effect from 'effect/Effect'
import * as Runtime from 'effect/Runtime'
import { applyRuntimeLoadFailureToLifecycle } from '../extensions/runtime-load-failure'
import {
  activateTrustedMainExtension,
  hasTrustedMainRuntime,
  type TrustedMainExtensionCleanup,
  type TrustedMainExtensionModuleLoader,
} from '../extensions/trusted-main-runtime'
import type { DiscoveredExtensionPackage, ExtensionLifecycleState } from '../extensions/types'
import type { ActiveProjectChangeService } from '../ports/active-project-change-service'
import type { DocsBundleService } from '../ports/docs-bundle-service'
import { ExtensionLifecycleRepository } from '../ports/extension-lifecycle-repository'
import type { ExtensionManagerService } from '../ports/extension-manager-service'
import type { ExtensionProjectOverridesRepository } from '../ports/extension-project-overrides-repository'
import type { ExtensionStorageRepository } from '../ports/extension-storage-repository'
import type { SessionProjectionRepository } from '../ports/session-projection-repository'
import type { SessionRepository } from '../ports/session-repository'
import { AppLogger } from '../services/logger-service'
import { SettingsService } from '../services/settings-service'
import { invokeExtensionCapability } from './extension-capability-broker-service'
import { loadRuntimeEnabledTrustedMainPackages } from './extension-trusted-main-selection-service'

export type TrustedMainActivationBaseServices =
  | AppLogger
  | DocsBundleService
  | ExtensionLifecycleRepository
  | ExtensionManagerService
  | ExtensionProjectOverridesRepository
  | ExtensionStorageRepository
  | SessionProjectionRepository
  | SessionRepository
  | SettingsService

export type TrustedMainActivationServices =
  | TrustedMainActivationBaseServices
  | ActiveProjectChangeService

interface ActiveTrustedMainExtension {
  readonly extensionId: string
  readonly scope: DiscoveredExtensionPackage['scope']
  readonly contentHash: string
  readonly cleanup: TrustedMainExtensionCleanup | null
}

export interface TrustedMainActivationDependencies {
  readonly loadModule?: TrustedMainExtensionModuleLoader
  readonly now?: () => number
}

export type TrustedMainActivationStatus = 'activated' | 'already-active' | 'failed' | 'skipped'

export interface TrustedMainActivationResult {
  readonly extensionId: string
  readonly status: TrustedMainActivationStatus
  readonly errorMessage?: string
}

const activeTrustedMainExtensions = new Map<string, ActiveTrustedMainExtension>()

function describeError(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function trustedMainActivationKey(input: {
  readonly extensionPackage: DiscoveredExtensionPackage
  readonly activationProjectPath: string | null
}) {
  const extensionPackage = input.extensionPackage
  return extensionPackage.scope.kind === OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND
    ? `global:${input.activationProjectPath ?? OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_ID}:${extensionPackage.id}`
    : `project:${extensionPackage.scope.projectPath}:${extensionPackage.id}`
}

function scopesMatch(
  left: DiscoveredExtensionPackage['scope'],
  right: DiscoveredExtensionPackage['scope'],
) {
  if (left.kind !== right.kind) {
    return false
  }

  if (left.kind === OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND) {
    return true
  }

  return (
    right.kind === OPENWAGGLE_EXTENSION.SCOPE.PROJECT_KIND && left.projectPath === right.projectPath
  )
}

function activationMatchesPackage(input: {
  readonly activation: ActiveTrustedMainExtension
  readonly extensionPackage: DiscoveredExtensionPackage
}) {
  return (
    input.activation.extensionId === input.extensionPackage.id &&
    scopesMatch(input.activation.scope, input.extensionPackage.scope)
  )
}

function currentTimestamp(dependencies: TrustedMainActivationDependencies) {
  return dependencies.now?.() ?? Date.now()
}

function deactivateTrustedMainActivationKey(activationKey: string) {
  const activation = activeTrustedMainExtensions.get(activationKey) ?? null
  activeTrustedMainExtensions.delete(activationKey)
  return activation
}

function cleanupTrustedMainActivation(input: { readonly cleanup: TrustedMainExtensionCleanup }) {
  return Effect.tryPromise({
    try: () => Promise.resolve(input.cleanup()),
    catch: (error) => error,
  }).pipe(Effect.catchAll(() => Effect.void))
}

function recordTrustedMainActivationFailure(input: {
  readonly extensionPackage: DiscoveredExtensionPackage
  readonly lifecycle: ExtensionLifecycleState
  readonly error: unknown
  readonly now: number
}) {
  return Effect.gen(function* () {
    const logger = yield* AppLogger
    const lifecycleRepository = yield* ExtensionLifecycleRepository
    const nextLifecycle = applyRuntimeLoadFailureToLifecycle({
      extensionPackage: input.extensionPackage,
      lifecycle: input.lifecycle,
      error: input.error,
      now: input.now,
    })

    yield* lifecycleRepository.upsert(nextLifecycle).pipe(
      Effect.catchAll((error) =>
        logger.warn('extension-trusted-main', 'Failed to persist trusted main activation failure', {
          extensionId: input.extensionPackage.id,
          error: describeError(error),
        }),
      ),
    )
    yield* logger.warn('extension-trusted-main', 'Trusted main extension activation failed', {
      extensionId: input.extensionPackage.id,
      error: describeError(input.error),
    })
  })
}

function makeBrokerTransport(
  runtime: Runtime.Runtime<TrustedMainActivationServices>,
): ExtensionBrokerTransport {
  const runBroker = Runtime.runPromise(runtime)
  return (invocation) => runBroker(invokeExtensionCapability(invocation))
}

export function deactivateTrustedMainExtensionPackage(
  extensionPackage: DiscoveredExtensionPackage,
): Effect.Effect<void> {
  return Effect.gen(function* () {
    const packageActivationKeys = [...activeTrustedMainExtensions.entries()]
      .filter(([, activation]) => activationMatchesPackage({ activation, extensionPackage }))
      .map(([activationKey]) => activationKey)

    yield* deactivateTrustedMainActivationKeys(packageActivationKeys)
  })
}

function deactivateTrustedMainActivationKeys(activationKeys: readonly string[]) {
  return Effect.forEach(activationKeys, (activationKey) =>
    Effect.gen(function* () {
      const activation = deactivateTrustedMainActivationKey(activationKey)
      if (activation?.cleanup) {
        yield* cleanupTrustedMainActivation({ cleanup: activation.cleanup })
      }
    }),
  )
}

export function activateTrustedMainExtensionPackage(
  input: {
    readonly extensionPackage: DiscoveredExtensionPackage
    readonly lifecycle: ExtensionLifecycleState
    readonly activationProjectPath?: string | null
  },
  dependencies: TrustedMainActivationDependencies = {},
): Effect.Effect<TrustedMainActivationResult, never, TrustedMainActivationServices> {
  return Effect.gen(function* () {
    const extensionPackage = input.extensionPackage
    const contentHash = extensionPackage.contentHash
    if (!hasTrustedMainRuntime(extensionPackage) || contentHash === null) {
      return {
        extensionId: extensionPackage.id,
        status: 'skipped',
      } satisfies TrustedMainActivationResult
    }

    const activationKey = trustedMainActivationKey({
      extensionPackage,
      activationProjectPath: input.activationProjectPath ?? null,
    })
    const active = activeTrustedMainExtensions.get(activationKey) ?? null
    if (active?.contentHash === contentHash) {
      return {
        extensionId: extensionPackage.id,
        status: 'already-active',
      } satisfies TrustedMainActivationResult
    }

    yield* deactivateTrustedMainExtensionPackage(extensionPackage)

    const runtime = yield* Effect.runtime<TrustedMainActivationServices>()
    const transport = makeBrokerTransport(runtime)
    const activation = yield* Effect.tryPromise({
      try: () =>
        activateTrustedMainExtension({
          extensionPackage,
          contentHash,
          transport,
          ...(dependencies.loadModule !== undefined ? { loadModule: dependencies.loadModule } : {}),
        }),
      catch: (error) => error,
    }).pipe(
      Effect.catchAll((error) =>
        recordTrustedMainActivationFailure({
          extensionPackage,
          lifecycle: input.lifecycle,
          error,
          now: currentTimestamp(dependencies),
        }).pipe(
          Effect.as({
            extensionId: extensionPackage.id,
            status: 'failed',
            errorMessage: describeError(error),
          } satisfies TrustedMainActivationResult),
        ),
      ),
    )

    if ('status' in activation) {
      return activation
    }

    activeTrustedMainExtensions.set(activationKey, {
      extensionId: extensionPackage.id,
      scope: extensionPackage.scope,
      contentHash,
      cleanup: activation.cleanup,
    })

    return {
      extensionId: extensionPackage.id,
      status: 'activated',
    } satisfies TrustedMainActivationResult
  })
}

export function activateTrustedMainExtensionsForProject(
  projectPath: string | null,
  dependencies: TrustedMainActivationDependencies = {},
) {
  return reconcileTrustedMainExtensionsForProject(projectPath, dependencies)
}

export function reconcileTrustedMainExtensionsForProject(
  projectPath: string | null,
  dependencies: TrustedMainActivationDependencies = {},
) {
  return Effect.gen(function* () {
    const enabledPackages = yield* loadRuntimeEnabledTrustedMainPackages(projectPath)
    const enabledActivationKeys = new Set(
      enabledPackages.map((enabledPackage) =>
        trustedMainActivationKey({
          extensionPackage: enabledPackage.extensionPackage,
          activationProjectPath: projectPath,
        }),
      ),
    )
    const staleActivationKeys = [...activeTrustedMainExtensions.keys()].filter(
      (activationKey) => !enabledActivationKeys.has(activationKey),
    )

    yield* deactivateTrustedMainActivationKeys(staleActivationKeys)

    return yield* Effect.forEach(enabledPackages, (enabledPackage) =>
      activateTrustedMainExtensionPackage(
        { ...enabledPackage, activationProjectPath: projectPath },
        dependencies,
      ),
    )
  })
}

export function activateTrustedMainExtensionsForActiveProject(
  dependencies: TrustedMainActivationDependencies = {},
) {
  return Effect.gen(function* () {
    const settings = yield* SettingsService
    const projectPath = (yield* settings.get()).projectPath
    return yield* reconcileTrustedMainExtensionsForProject(projectPath, dependencies)
  })
}

export function clearTrustedMainExtensionActivationsForTests() {
  activeTrustedMainExtensions.clear()
}

export function getTrustedMainExtensionActivationCountForTests() {
  return activeTrustedMainExtensions.size
}
