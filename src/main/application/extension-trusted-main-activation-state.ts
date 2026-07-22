import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import * as Effect from 'effect/Effect'
import type { TrustedMainExtensionCleanup } from '../extensions/trusted-main-runtime'
import type { DiscoveredExtensionPackage } from '../extensions/types'

interface ActiveTrustedMainExtension {
  readonly extensionPackage: DiscoveredExtensionPackage
  readonly contentHash: string
  readonly cleanup: TrustedMainExtensionCleanup | null
}

const activeTrustedMainExtensions = new Map<string, ActiveTrustedMainExtension>()

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
  const activePackage = input.activation.extensionPackage
  return (
    activePackage.id === input.extensionPackage.id &&
    scopesMatch(activePackage.scope, input.extensionPackage.scope)
  )
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

export function trustedMainActivationKey(input: {
  readonly extensionPackage: DiscoveredExtensionPackage
  readonly activationProjectPath: string | null
}) {
  const extensionPackage = input.extensionPackage
  return extensionPackage.scope.kind === OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND
    ? `global:${input.activationProjectPath ?? OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_ID}:${extensionPackage.id}`
    : `project:${extensionPackage.scope.projectPath}:${extensionPackage.id}`
}

export function getActiveTrustedMainActivation(activationKey: string) {
  return activeTrustedMainExtensions.get(activationKey) ?? null
}

export function setActiveTrustedMainActivation(input: {
  readonly activationKey: string
  readonly extensionPackage: DiscoveredExtensionPackage
  readonly contentHash: string
  readonly cleanup: TrustedMainExtensionCleanup | null
}) {
  activeTrustedMainExtensions.set(input.activationKey, {
    extensionPackage: input.extensionPackage,
    contentHash: input.contentHash,
    cleanup: input.cleanup,
  })
}

export function listTrustedMainActivationKeys() {
  return [...activeTrustedMainExtensions.keys()]
}

export function deactivateTrustedMainActivationKeys(
  activationKeys: readonly string[],
): Effect.Effect<readonly DiscoveredExtensionPackage[]> {
  return Effect.gen(function* () {
    const deactivatedPackages: DiscoveredExtensionPackage[] = []

    for (const activationKey of activationKeys) {
      const activation = deactivateTrustedMainActivationKey(activationKey)
      if (!activation) {
        continue
      }

      deactivatedPackages.push(activation.extensionPackage)
      if (activation?.cleanup) {
        yield* cleanupTrustedMainActivation({ cleanup: activation.cleanup })
      }
    }

    return deactivatedPackages
  })
}

export function deactivateTrustedMainExtensionPackage(
  extensionPackage: DiscoveredExtensionPackage,
): Effect.Effect<readonly DiscoveredExtensionPackage[]> {
  return Effect.gen(function* () {
    const packageActivationKeys: string[] = []
    for (const [activationKey, activation] of activeTrustedMainExtensions) {
      if (activationMatchesPackage({ activation, extensionPackage })) {
        packageActivationKeys.push(activationKey)
      }
    }

    return yield* deactivateTrustedMainActivationKeys(packageActivationKeys)
  })
}

export function clearTrustedMainExtensionActivationsForTests() {
  activeTrustedMainExtensions.clear()
}

export function getTrustedMainExtensionActivationCountForTests() {
  return activeTrustedMainExtensions.size
}
