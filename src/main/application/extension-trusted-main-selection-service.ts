import * as Effect from 'effect/Effect'
import { isExtensionRuntimeEnabled } from '../extensions/runtime-eligibility'
import { hasTrustedMainRuntime } from '../extensions/trusted-main-runtime'
import type { DiscoveredExtensionPackage, ExtensionLifecycleState } from '../extensions/types'
import { ExtensionLifecycleRepository } from '../ports/extension-lifecycle-repository'
import { ExtensionManagerService } from '../ports/extension-manager-service'
import { ExtensionProjectOverridesRepository } from '../ports/extension-project-overrides-repository'
import { AppLogger } from '../services/logger-service'

export interface RuntimeEnabledTrustedMainPackage {
  readonly extensionPackage: DiscoveredExtensionPackage
  readonly lifecycle: ExtensionLifecycleState
}

function describeError(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function present<T>(value: T | null): value is T {
  return value !== null
}

function projectPackageAppliesToPath(
  extensionPackage: DiscoveredExtensionPackage,
  projectPath: string | null,
) {
  return (
    projectPath !== null &&
    extensionPackage.scope.kind === 'project' &&
    extensionPackage.scope.projectPath === projectPath
  )
}

function packageAppliesToActivationProject(
  extensionPackage: DiscoveredExtensionPackage,
  projectPath: string | null,
) {
  return (
    extensionPackage.scope.kind === 'global' ||
    projectPackageAppliesToPath(extensionPackage, projectPath)
  )
}

function listPackagesSafely(projectPath: string | null) {
  return Effect.gen(function* () {
    const logger = yield* AppLogger
    const manager = yield* ExtensionManagerService
    return yield* manager.listPackages({ projectPath }).pipe(
      Effect.catchAll((error) =>
        logger
          .warn('extension-trusted-main', 'Failed to discover trusted main extension packages', {
            projectPath,
            error: describeError(error),
          })
          .pipe(Effect.as([])),
      ),
    )
  })
}

function loadLifecycleSafely(extensionPackage: DiscoveredExtensionPackage) {
  return Effect.gen(function* () {
    const logger = yield* AppLogger
    const lifecycleRepository = yield* ExtensionLifecycleRepository
    return yield* lifecycleRepository
      .get({
        extensionId: extensionPackage.id,
        scope: extensionPackage.scope,
      })
      .pipe(
        Effect.catchAll((error) =>
          logger
            .warn('extension-trusted-main', 'Failed to read trusted main lifecycle state', {
              extensionId: extensionPackage.id,
              error: describeError(error),
            })
            .pipe(Effect.as(null)),
        ),
      )
  })
}

function loadProjectOverrideSafely(
  extensionPackage: DiscoveredExtensionPackage,
  projectPath: string | null,
) {
  return Effect.gen(function* () {
    if (!projectPath) {
      return null
    }

    const logger = yield* AppLogger
    const projectOverridesRepository = yield* ExtensionProjectOverridesRepository
    return yield* projectOverridesRepository
      .get({
        extensionId: extensionPackage.id,
        scope: extensionPackage.scope,
        projectPath,
      })
      .pipe(
        Effect.catchAll((error) =>
          logger
            .warn('extension-trusted-main', 'Failed to read trusted main project override', {
              extensionId: extensionPackage.id,
              projectPath,
              error: describeError(error),
            })
            .pipe(Effect.as({ disabled: true })),
        ),
      )
  })
}

function toRuntimeEnabledTrustedMainPackage(input: {
  readonly extensionPackage: DiscoveredExtensionPackage
  readonly projectPath: string | null
}) {
  return Effect.gen(function* () {
    const lifecycle = yield* loadLifecycleSafely(input.extensionPackage)
    const projectOverride = yield* loadProjectOverrideSafely(
      input.extensionPackage,
      input.projectPath,
    )

    return lifecycle &&
      isExtensionRuntimeEnabled({
        extensionPackage: input.extensionPackage,
        lifecycle,
        projectOverride,
      })
      ? { extensionPackage: input.extensionPackage, lifecycle }
      : null
  })
}

export function loadRuntimeEnabledTrustedMainPackages(projectPath: string | null) {
  return Effect.gen(function* () {
    const packages = yield* listPackagesSafely(projectPath)
    const candidates = packages.filter(
      (extensionPackage) =>
        packageAppliesToActivationProject(extensionPackage, projectPath) &&
        hasTrustedMainRuntime(extensionPackage),
    )
    const enabledPackages = yield* Effect.forEach(candidates, (extensionPackage) =>
      toRuntimeEnabledTrustedMainPackage({ extensionPackage, projectPath }),
    )

    return enabledPackages.filter(present)
  })
}
