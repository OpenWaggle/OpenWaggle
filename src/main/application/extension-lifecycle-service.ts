import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import type {
  ExtensionAcceptUpdateInput,
  ExtensionApproveBuildInput,
  ExtensionSetEnabledInput,
  ExtensionSetProjectDisabledInput,
  ExtensionSetTrustedInput,
} from '@shared/types/extensions'
import * as Effect from 'effect/Effect'
import { isExtensionUpdateAvailable } from '../extensions/runtime-eligibility'
import { ExtensionLifecycleRepository } from '../ports/extension-lifecycle-repository'
import { ExtensionManagerService } from '../ports/extension-manager-service'
import { ExtensionProjectOverridesRepository } from '../ports/extension-project-overrides-repository'
import {
  findPackage,
  getBuildApprovalReadinessError,
  getLifecycleDiscoveryProjectPath,
  getLifecycleReadinessError,
  getProjectDisabledViewProjectPaths,
  getViewProjectPaths,
  type LifecycleMutationInput,
  lifecycleKey,
  makeLifecycleState,
  projectOverrideKey,
} from './extension-lifecycle-model'
import { listExtensionPackagesView } from './extension-manager-view-service'

function loadMutationPackage(input: LifecycleMutationInput) {
  return Effect.gen(function* () {
    const manager = yield* ExtensionManagerService
    const packages = yield* manager.listPackages({
      projectPath: getLifecycleDiscoveryProjectPath(input),
    })
    const extensionPackage = findPackage(packages, input)
    if (!extensionPackage) {
      return yield* Effect.fail(
        new Error(`Extension package "${input.extensionId}" was not found.`),
      )
    }
    return extensionPackage
  })
}

function loadProjectOverridePackage(input: ExtensionSetProjectDisabledInput) {
  return Effect.gen(function* () {
    const manager = yield* ExtensionManagerService
    const packages = yield* manager.listPackages({ projectPath: input.projectPath })
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
      const readinessError = getLifecycleReadinessError(extensionPackage, 'trust', current)
      if (readinessError) {
        return yield* Effect.fail(new Error(readinessError))
      }
      if (isExtensionUpdateAvailable({ extensionPackage, lifecycle: current })) {
        return yield* Effect.fail(
          new Error(OPENWAGGLE_EXTENSION.LIFECYCLE.APPROVE_UPDATE_REQUIRED_ERROR),
        )
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

    return yield* listExtensionPackagesView({ projectPaths: getViewProjectPaths(input) })
  })
}

export function setExtensionEnabled(input: ExtensionSetEnabledInput) {
  return Effect.gen(function* () {
    const lifecycleRepository = yield* ExtensionLifecycleRepository
    const extensionPackage = yield* loadMutationPackage(input)
    const current = yield* lifecycleRepository.get(lifecycleKey(input))

    if (input.enabled) {
      const readinessError = getLifecycleReadinessError(extensionPackage, 'enable', current)
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

    return yield* listExtensionPackagesView({ projectPaths: getViewProjectPaths(input) })
  })
}

export function acceptExtensionUpdate(input: ExtensionAcceptUpdateInput) {
  return Effect.gen(function* () {
    const lifecycleRepository = yield* ExtensionLifecycleRepository
    const extensionPackage = yield* loadMutationPackage(input)
    const current = yield* lifecycleRepository.get(lifecycleKey(input))

    if (!current?.trusted) {
      return yield* Effect.fail(new Error(OPENWAGGLE_EXTENSION.LIFECYCLE.UNTRUSTED_UPDATE_ERROR))
    }
    if (!isExtensionUpdateAvailable({ extensionPackage, lifecycle: current })) {
      return yield* Effect.fail(new Error(OPENWAGGLE_EXTENSION.LIFECYCLE.NO_UPDATE_AVAILABLE_ERROR))
    }

    const readinessError = getLifecycleReadinessError(extensionPackage, 'trust', current)
    if (readinessError) {
      return yield* Effect.fail(new Error(readinessError))
    }

    yield* lifecycleRepository.upsert(
      makeLifecycleState({
        extensionPackage,
        current,
        enabled: false,
        trusted: true,
        pinCurrentPackage: true,
      }),
    )

    return yield* listExtensionPackagesView({ projectPaths: getViewProjectPaths(input) })
  })
}

export function approveExtensionBuild(input: ExtensionApproveBuildInput) {
  return Effect.gen(function* () {
    const lifecycleRepository = yield* ExtensionLifecycleRepository
    const extensionPackage = yield* loadMutationPackage(input)
    const current = yield* lifecycleRepository.get(lifecycleKey(input))
    const readinessError = getBuildApprovalReadinessError(extensionPackage)

    if (readinessError) {
      return yield* Effect.fail(new Error(readinessError))
    }

    yield* lifecycleRepository.upsert(
      makeLifecycleState({
        extensionPackage,
        current,
        enabled: false,
        trusted: current?.trusted ?? false,
        pinCurrentPackage: false,
        approvedBuildPlanHash: extensionPackage.buildPlan?.inputHash ?? null,
      }),
    )

    return yield* listExtensionPackagesView({ projectPaths: getViewProjectPaths(input) })
  })
}

export function setExtensionProjectDisabled(input: ExtensionSetProjectDisabledInput) {
  return Effect.gen(function* () {
    if (!input.projectPath) {
      return yield* Effect.fail(
        new Error(OPENWAGGLE_EXTENSION.PROJECT_OVERRIDE.REQUIRED_PROJECT_PATH_ERROR),
      )
    }

    const projectOverridesRepository = yield* ExtensionProjectOverridesRepository
    const extensionPackage = yield* loadProjectOverridePackage(input)
    const key = projectOverrideKey(input)
    const current = yield* projectOverridesRepository.get(key)
    const now = Date.now()

    yield* projectOverridesRepository.upsert({
      extensionId: extensionPackage.id,
      scope: extensionPackage.scope,
      projectPath: input.projectPath,
      disabled: input.disabled,
      createdAt: current?.createdAt ?? now,
      updatedAt: now,
    })

    return yield* listExtensionPackagesView({
      projectPaths: getProjectDisabledViewProjectPaths(input),
    })
  })
}
