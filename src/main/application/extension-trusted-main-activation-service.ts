import type { ExtensionBrokerTransport } from '@shared/extension-sdk-core'
import * as Effect from 'effect/Effect'
import * as Runtime from 'effect/Runtime'
import {
  activateTrustedMainExtension,
  hasTrustedMainRuntime,
  type TrustedMainExtensionModuleLoader,
} from '../extensions/trusted-main-runtime'
import type { DiscoveredExtensionPackage, ExtensionLifecycleState } from '../extensions/types'
import type { ActiveProjectChangeService } from '../ports/active-project-change-service'
import type { DocsBundleService } from '../ports/docs-bundle-service'
import type { ExtensionLifecycleRepository } from '../ports/extension-lifecycle-repository'
import type { ExtensionManagerService } from '../ports/extension-manager-service'
import type { ExtensionProjectOverridesRepository } from '../ports/extension-project-overrides-repository'
import type { ExtensionStorageRepository } from '../ports/extension-storage-repository'
import type { SessionProjectionRepository } from '../ports/session-projection-repository'
import type { SessionRepository } from '../ports/session-repository'
import { AppLogger } from '../services/logger-service'
import { SettingsService } from '../services/settings-service'
import { invokeExtensionCapability } from './extension-capability-broker-service'
import { clearCachedPackageContributionRegistrations } from './extension-contribution-registry-cache'
import {
  describeTrustedMainActivationCause,
  recordTrustedMainActivationCauseFailureResult,
  recordTrustedMainActivationFailureResult,
} from './extension-trusted-main-activation-failure'
import {
  deactivateTrustedMainActivationKeys as deactivateTrustedMainActivationKeysInState,
  deactivateTrustedMainExtensionPackage as deactivateTrustedMainExtensionPackageInState,
  getActiveTrustedMainActivation,
  listTrustedMainActivationKeys,
  setActiveTrustedMainActivation,
  trustedMainActivationKey,
} from './extension-trusted-main-activation-state'
import { loadRuntimeEnabledTrustedMainPackages } from './extension-trusted-main-selection-service'

export {
  clearTrustedMainExtensionActivationsForTests,
  getTrustedMainExtensionActivationCountForTests,
} from './extension-trusted-main-activation-state'

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

const EMPTY_TRUSTED_MAIN_ACTIVATION_RESULTS: readonly TrustedMainActivationResult[] = []

function currentTimestamp(dependencies: TrustedMainActivationDependencies) {
  return dependencies.now?.() ?? Date.now()
}

function makeBrokerTransport(
  runtime: Runtime.Runtime<TrustedMainActivationServices>,
): ExtensionBrokerTransport {
  const runBroker = Runtime.runPromise(runtime)
  return (invocation) => runBroker(invokeExtensionCapability(invocation))
}

function clearTrustedMainContributionRegistrations(
  extensionPackages: readonly DiscoveredExtensionPackage[],
) {
  return Effect.sync(() => {
    for (const extensionPackage of extensionPackages) {
      clearCachedPackageContributionRegistrations(extensionPackage)
    }
  })
}

function deactivateTrustedMainActivationKeys(activationKeys: readonly string[]) {
  return Effect.gen(function* () {
    const deactivatedPackages = yield* deactivateTrustedMainActivationKeysInState(activationKeys)
    yield* clearTrustedMainContributionRegistrations(deactivatedPackages)
  })
}

export function deactivateTrustedMainExtensionPackage(
  extensionPackage: DiscoveredExtensionPackage,
): Effect.Effect<void> {
  return Effect.gen(function* () {
    const deactivatedPackages =
      yield* deactivateTrustedMainExtensionPackageInState(extensionPackage)
    yield* clearTrustedMainContributionRegistrations(deactivatedPackages)
  })
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
    const active = getActiveTrustedMainActivation(activationKey)
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
        Effect.gen(function* () {
          yield* clearTrustedMainContributionRegistrations([extensionPackage])
          return yield* recordTrustedMainActivationFailureResult({
            extensionPackage,
            lifecycle: input.lifecycle,
            error,
            now: currentTimestamp(dependencies),
          })
        }),
      ),
    )

    if ('status' in activation) {
      return activation
    }

    setActiveTrustedMainActivation({
      activationKey,
      extensionPackage,
      contentHash,
      cleanup: activation.cleanup,
    })

    return {
      extensionId: extensionPackage.id,
      status: 'activated',
    } satisfies TrustedMainActivationResult
  })
}

function activateTrustedMainExtensionPackageSafely(
  input: {
    readonly extensionPackage: DiscoveredExtensionPackage
    readonly lifecycle: ExtensionLifecycleState
    readonly activationProjectPath?: string | null
  },
  dependencies: TrustedMainActivationDependencies,
) {
  return activateTrustedMainExtensionPackage(input, dependencies).pipe(
    Effect.catchAllCause((cause) =>
      recordTrustedMainActivationCauseFailureResult({
        extensionPackage: input.extensionPackage,
        lifecycle: input.lifecycle,
        cause,
        now: currentTimestamp(dependencies),
      }),
    ),
  )
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
    const staleActivationKeys = listTrustedMainActivationKeys().filter(
      (activationKey) => !enabledActivationKeys.has(activationKey),
    )

    yield* deactivateTrustedMainActivationKeys(staleActivationKeys)

    return yield* Effect.forEach(enabledPackages, (enabledPackage) =>
      activateTrustedMainExtensionPackageSafely(
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

export function activateTrustedMainExtensionsForActiveProjectSafely(
  dependencies: TrustedMainActivationDependencies = {},
) {
  return activateTrustedMainExtensionsForActiveProject(dependencies).pipe(
    Effect.catchAllCause((cause) =>
      Effect.gen(function* () {
        const logger = yield* AppLogger
        yield* logger.warn(
          'extension-trusted-main',
          'Skipped trusted main extension startup after activation failure',
          { error: describeTrustedMainActivationCause(cause) },
        )
        return EMPTY_TRUSTED_MAIN_ACTIVATION_RESULTS
      }),
    ),
  )
}
