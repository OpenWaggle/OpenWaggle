import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import type { ExtensionSetEnabledInput, ExtensionSetTrustedInput } from '@shared/types/extensions'
import * as Effect from 'effect/Effect'
import type {
  DiscoveredExtensionPackage,
  ExtensionLifecycleKey,
  ExtensionLifecycleState,
  ExtensionPackageScope,
} from '../extensions/types'
import { ExtensionLifecycleRepository } from '../ports/extension-lifecycle-repository'
import { ExtensionManagerService } from '../ports/extension-manager-service'
import { listExtensionPackagesView } from './extension-manager-view-service'

function scopeKey(scope: ExtensionPackageScope) {
  return scope.kind === OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND
    ? `${OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND}:${OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_ID}`
    : `${OPENWAGGLE_EXTENSION.SCOPE.PROJECT_KIND}:${scope.projectPath}`
}

function scopeMatches(left: ExtensionPackageScope, right: ExtensionPackageScope) {
  return scopeKey(left) === scopeKey(right)
}

function getViewProjectPath(input: ExtensionSetTrustedInput | ExtensionSetEnabledInput) {
  if (input.viewProjectPath !== undefined && input.viewProjectPath !== null) {
    return input.viewProjectPath
  }
  return input.scope.kind === OPENWAGGLE_EXTENSION.SCOPE.PROJECT_KIND
    ? input.scope.projectPath
    : null
}

function lifecycleKey(input: ExtensionSetTrustedInput | ExtensionSetEnabledInput) {
  return {
    extensionId: input.extensionId,
    scope: input.scope,
  } satisfies ExtensionLifecycleKey
}

function findPackage(
  packages: readonly DiscoveredExtensionPackage[],
  input: ExtensionSetTrustedInput | ExtensionSetEnabledInput,
) {
  return (
    packages.find(
      (extensionPackage) =>
        extensionPackage.id === input.extensionId &&
        scopeMatches(extensionPackage.scope, input.scope),
    ) ?? null
  )
}

function getPackageErrorCodes(extensionPackage: DiscoveredExtensionPackage) {
  return extensionPackage.diagnostics
    .filter((diagnostic) => diagnostic.severity === 'error')
    .map((diagnostic) => diagnostic.code)
}

function getLifecycleReadinessError(
  extensionPackage: DiscoveredExtensionPackage,
  action: 'trust' | 'enable',
) {
  if (!extensionPackage.manifest) {
    return `Cannot ${action} "${extensionPackage.id}" because its manifest is invalid.`
  }
  if (!extensionPackage.contentHash) {
    return `Cannot ${action} "${extensionPackage.id}" because its content hash is unavailable.`
  }
  if (!extensionPackage.sdkCompatibility?.compatible) {
    return `Cannot ${action} "${extensionPackage.id}" because its SDK range is incompatible.`
  }

  const errorCodes = getPackageErrorCodes(extensionPackage)
  if (errorCodes.length > 0) {
    return `Cannot ${action} "${extensionPackage.id}" because package diagnostics include errors: ${errorCodes.join(', ')}.`
  }

  return null
}

function getGrantedCapabilities(extensionPackage: DiscoveredExtensionPackage) {
  return extensionPackage.manifest?.capabilities?.map((capability) => capability.id) ?? []
}

function pinnedContentHash({
  extensionPackage,
  current,
  trusted,
  pinCurrentPackage,
}: {
  readonly extensionPackage: DiscoveredExtensionPackage
  readonly current: ExtensionLifecycleState | null
  readonly trusted: boolean
  readonly pinCurrentPackage: boolean
}) {
  if (!trusted) {
    return null
  }
  return pinCurrentPackage
    ? extensionPackage.contentHash
    : (current?.contentHash ?? extensionPackage.contentHash)
}

function makeLifecycleState({
  extensionPackage,
  current,
  enabled,
  trusted,
  pinCurrentPackage,
}: {
  readonly extensionPackage: DiscoveredExtensionPackage
  readonly current: ExtensionLifecycleState | null
  readonly enabled: boolean
  readonly trusted: boolean
  readonly pinCurrentPackage: boolean
}): ExtensionLifecycleState {
  const now = Date.now()
  return {
    extensionId: extensionPackage.id,
    scope: extensionPackage.scope,
    enabled,
    trusted,
    grantedCapabilities: trusted ? getGrantedCapabilities(extensionPackage) : [],
    contentHash: pinnedContentHash({ extensionPackage, current, trusted, pinCurrentPackage }),
    sdkRange: extensionPackage.manifest?.sdk.openwaggle ?? null,
    sdkCompatible: extensionPackage.sdkCompatibility?.compatible ?? false,
    diagnostics: extensionPackage.diagnostics,
    installedAt: current?.installedAt ?? now,
    updatedAt: now,
  }
}

function loadMutationPackage(input: ExtensionSetTrustedInput | ExtensionSetEnabledInput) {
  return Effect.gen(function* () {
    const manager = yield* ExtensionManagerService
    const packages = yield* manager.listPackages({ projectPath: getViewProjectPath(input) })
    const extensionPackage = findPackage(packages, input)
    if (!extensionPackage) {
      return yield* Effect.fail(
        new Error(`Extension package "${input.extensionId}" was not found.`),
      )
    }
    return extensionPackage
  })
}

export function setExtensionTrusted(input: ExtensionSetTrustedInput) {
  return Effect.gen(function* () {
    const lifecycleRepository = yield* ExtensionLifecycleRepository
    const extensionPackage = yield* loadMutationPackage(input)
    const current = yield* lifecycleRepository.get(lifecycleKey(input))

    if (input.trusted) {
      const readinessError = getLifecycleReadinessError(extensionPackage, 'trust')
      if (readinessError) {
        return yield* Effect.fail(new Error(readinessError))
      }
    }

    yield* lifecycleRepository.upsert(
      makeLifecycleState({
        extensionPackage,
        current,
        enabled: false,
        trusted: input.trusted,
        pinCurrentPackage: input.trusted,
      }),
    )

    return yield* listExtensionPackagesView(getViewProjectPath(input))
  })
}

export function setExtensionEnabled(input: ExtensionSetEnabledInput) {
  return Effect.gen(function* () {
    const lifecycleRepository = yield* ExtensionLifecycleRepository
    const extensionPackage = yield* loadMutationPackage(input)
    const current = yield* lifecycleRepository.get(lifecycleKey(input))

    if (input.enabled) {
      const readinessError = getLifecycleReadinessError(extensionPackage, 'enable')
      if (readinessError) {
        return yield* Effect.fail(new Error(readinessError))
      }
      if (!current?.trusted || current.contentHash !== extensionPackage.contentHash) {
        return yield* Effect.fail(
          new Error(`Trust extension "${extensionPackage.id}" before enabling it.`),
        )
      }
    }

    yield* lifecycleRepository.upsert(
      makeLifecycleState({
        extensionPackage,
        current,
        enabled: input.enabled,
        trusted: current?.trusted ?? false,
        pinCurrentPackage: false,
      }),
    )

    return yield* listExtensionPackagesView(getViewProjectPath(input))
  })
}
