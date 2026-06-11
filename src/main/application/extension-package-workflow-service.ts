import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import * as Effect from 'effect/Effect'
import type { DiscoveredExtensionPackage, ExtensionLifecycleState } from '../extensions/types'
import { ExtensionLifecycleRepository } from '../ports/extension-lifecycle-repository'
import { ExtensionManagerService } from '../ports/extension-manager-service'
import { ExtensionPackageRepository } from '../ports/extension-package-repository'
import { clearCachedPackageContributionRegistrations } from './extension-contribution-registry-cache'
import { findPackage, makeLifecycleState } from './extension-lifecycle-model'
import { listExtensionPackagesView } from './extension-manager-view-service'
import {
  EXTENSION_PACKAGE_WORKFLOW,
  type ExtensionPackageRemoveProposalInput,
  type ExtensionPackageRemoveWorkflowInput,
  type ExtensionPackageWorkflowGlobalConfirmation,
  type ExtensionPackageWorkflowTarget,
  type ExtensionPackageWriteProposalInput,
  type ExtensionPackageWriteWorkflowInput,
  getExtensionPackageRemoveProposal,
  getExtensionPackageRemoveProposalHash,
  getExtensionPackageWriteProposal,
  getExtensionPackageWriteProposalHash,
  validateExtensionPackageWriteManifestIdentity,
} from './extension-package-workflow-model'
import { deactivateTrustedMainExtensionPackage } from './extension-trusted-main-activation-service'

interface ExtensionPackageWorkflowBaseTarget {
  readonly extensionId: ExtensionPackageWorkflowTarget['extensionId']
  readonly scope: ExtensionPackageWorkflowTarget['scope']
  readonly actor: ExtensionPackageWorkflowTarget['actor']
  readonly viewProjectPaths?: ExtensionPackageWorkflowTarget['viewProjectPaths']
}

function getWorkflowViewProjectPaths(input: ExtensionPackageWorkflowBaseTarget) {
  if (input.viewProjectPaths !== undefined && input.viewProjectPaths.length > 0) {
    return input.viewProjectPaths
  }

  return input.scope.kind === OPENWAGGLE_EXTENSION.SCOPE.PROJECT_KIND
    ? [input.scope.projectPath]
    : []
}

function getWorkflowDiscoveryProjectPath(input: ExtensionPackageWorkflowBaseTarget) {
  return input.scope.kind === OPENWAGGLE_EXTENSION.SCOPE.PROJECT_KIND
    ? input.scope.projectPath
    : null
}

function validatePackageWorkflowActor(input: ExtensionPackageWorkflowBaseTarget) {
  if (input.actor.kind === 'extension') {
    return Effect.fail(new Error(EXTENSION_PACKAGE_WORKFLOW.ERROR.EXTENSION_ACTOR_REJECTED))
  }
  return Effect.void
}

function validateUserApproval(input: {
  readonly target: ExtensionPackageWorkflowTarget
  readonly proposalHash: string
}) {
  if (!input.target.userApproval.approved) {
    return Effect.fail(new Error(EXTENSION_PACKAGE_WORKFLOW.ERROR.APPROVAL_REQUIRED))
  }
  if (input.target.userApproval.approvedProposalHash !== input.proposalHash) {
    return Effect.fail(new Error(EXTENSION_PACKAGE_WORKFLOW.ERROR.APPROVAL_HASH_MISMATCH))
  }
  return Effect.void
}

function globalConfirmationMatches(input: {
  readonly confirmation: ExtensionPackageWorkflowGlobalConfirmation
  readonly target: ExtensionPackageWorkflowTarget
  readonly proposalHash: string
}) {
  return (
    input.confirmation.confirmed &&
    input.confirmation.confirmedExtensionId === input.target.extensionId &&
    input.confirmation.confirmedProposalHash === input.proposalHash &&
    input.confirmation.risk === EXTENSION_PACKAGE_WORKFLOW.GLOBAL_CONFIRMATION_RISK
  )
}

function validateGlobalConfirmation(input: {
  readonly target: ExtensionPackageWorkflowTarget
  readonly proposalHash: string
}) {
  if (input.target.scope.kind !== OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND) {
    return Effect.void
  }

  const confirmation = input.target.globalConfirmation
  if (
    confirmation === undefined ||
    !globalConfirmationMatches({
      confirmation,
      target: input.target,
      proposalHash: input.proposalHash,
    })
  ) {
    return Effect.fail(new Error(EXTENSION_PACKAGE_WORKFLOW.ERROR.GLOBAL_CONFIRMATION_REQUIRED))
  }
  return Effect.void
}

function validateWorkflowApproval(input: {
  readonly target: ExtensionPackageWorkflowTarget
  readonly proposalHash: string
}) {
  return Effect.gen(function* () {
    yield* validatePackageWorkflowActor(input.target)
    yield* validateUserApproval(input)
    yield* validateGlobalConfirmation(input)
  })
}

function validateWriteModeAgainstPackage(input: {
  readonly mode: ExtensionPackageWriteWorkflowInput['mode']
  readonly existingPackage: DiscoveredExtensionPackage | null
}) {
  if (input.mode === 'create' && input.existingPackage) {
    return Effect.fail(new Error(EXTENSION_PACKAGE_WORKFLOW.ERROR.CREATE_TARGET_EXISTS))
  }
  if (input.mode === 'update' && !input.existingPackage) {
    return Effect.fail(new Error(EXTENSION_PACKAGE_WORKFLOW.ERROR.UPDATE_TARGET_MISSING))
  }
  return Effect.void
}

function validateWriteManifestIdentity(input: {
  readonly extensionId: ExtensionPackageWriteWorkflowInput['extensionId']
  readonly files: ExtensionPackageWriteWorkflowInput['files']
}) {
  const validation = validateExtensionPackageWriteManifestIdentity(input)
  return validation._tag === 'valid' ? Effect.void : Effect.fail(new Error(validation.message))
}

function loadWorkflowPackage(input: ExtensionPackageWorkflowBaseTarget) {
  return Effect.gen(function* () {
    const manager = yield* ExtensionManagerService
    const packages = yield* manager.listPackages({
      projectPath: getWorkflowDiscoveryProjectPath(input),
    })
    return findPackage(packages, input)
  })
}

function unregisterPackage(extensionPackage: DiscoveredExtensionPackage) {
  return Effect.sync(() => {
    clearCachedPackageContributionRegistrations(extensionPackage)
  })
}

function disableLifecycleRuntimeState(input: {
  readonly extensionPackage: DiscoveredExtensionPackage
  readonly lifecycle: ExtensionLifecycleState
}) {
  return Effect.gen(function* () {
    const lifecycleRepository = yield* ExtensionLifecycleRepository
    yield* lifecycleRepository.upsert(
      makeLifecycleState({
        extensionPackage: input.extensionPackage,
        current: input.lifecycle,
        enabled: false,
        trusted: input.lifecycle.trusted,
        pinCurrentPackage: false,
        reloadStatus: OPENWAGGLE_EXTENSION.RELOAD_STATUS.NOT_RELOADED,
        lastReloadedAt: null,
      }),
    )
  })
}

function loadCurrentLifecycle(extensionPackage: DiscoveredExtensionPackage) {
  return Effect.gen(function* () {
    const lifecycleRepository = yield* ExtensionLifecycleRepository
    return yield* lifecycleRepository.get({
      extensionId: extensionPackage.id,
      scope: extensionPackage.scope,
    })
  })
}

function deleteLifecycleState(input: ExtensionPackageRemoveWorkflowInput) {
  return Effect.gen(function* () {
    const lifecycleRepository = yield* ExtensionLifecycleRepository
    const deleteLifecycle = lifecycleRepository.delete
    if (!deleteLifecycle) {
      return yield* Effect.fail(
        new Error('Extension lifecycle repository does not support uninstall cleanup.'),
      )
    }
    yield* deleteLifecycle({ extensionId: input.extensionId, scope: input.scope })
  })
}

export function proposeExtensionPackageWrite(input: ExtensionPackageWriteProposalInput) {
  return Effect.gen(function* () {
    yield* validatePackageWorkflowActor(input)
    yield* validateWriteManifestIdentity(input)
    const existingPackage = yield* loadWorkflowPackage(input)
    yield* validateWriteModeAgainstPackage({ mode: input.mode, existingPackage })

    return getExtensionPackageWriteProposal(input)
  })
}

export function proposeExtensionPackageRemove(input: ExtensionPackageRemoveProposalInput) {
  return Effect.gen(function* () {
    yield* validatePackageWorkflowActor(input)
    return getExtensionPackageRemoveProposal(input)
  })
}

export function createOrUpdateExtensionPackage(input: ExtensionPackageWriteWorkflowInput) {
  return Effect.gen(function* () {
    const proposalHash = getExtensionPackageWriteProposalHash(input)
    yield* validateWorkflowApproval({ target: input, proposalHash })
    yield* validateWriteManifestIdentity(input)

    const packageRepository = yield* ExtensionPackageRepository
    const existingPackage = yield* loadWorkflowPackage(input)
    yield* validateWriteModeAgainstPackage({ mode: input.mode, existingPackage })
    const currentLifecycle = existingPackage ? yield* loadCurrentLifecycle(existingPackage) : null

    yield* packageRepository.writePackage({
      extensionId: input.extensionId,
      scope: input.scope,
      mode: input.mode,
      files: input.files,
    })

    if (existingPackage) {
      yield* unregisterPackage(existingPackage)
    }

    const writtenPackage = yield* loadWorkflowPackage(input)
    if (writtenPackage && currentLifecycle) {
      yield* disableLifecycleRuntimeState({
        extensionPackage: writtenPackage,
        lifecycle: currentLifecycle,
      })
      yield* deactivateTrustedMainExtensionPackage(writtenPackage)
    }
    if (writtenPackage) {
      yield* unregisterPackage(writtenPackage)
    }

    return yield* listExtensionPackagesView({ projectPaths: getWorkflowViewProjectPaths(input) })
  })
}

export function removeExtensionPackage(input: ExtensionPackageRemoveWorkflowInput) {
  return Effect.gen(function* () {
    const proposalHash = getExtensionPackageRemoveProposalHash(input)
    yield* validateWorkflowApproval({ target: input, proposalHash })

    const existingPackage = yield* loadWorkflowPackage(input)
    if (existingPackage) {
      yield* unregisterPackage(existingPackage)
      yield* deactivateTrustedMainExtensionPackage(existingPackage)
    }

    const packageRepository = yield* ExtensionPackageRepository
    yield* packageRepository.removePackage({
      extensionId: input.extensionId,
      scope: input.scope,
    })
    yield* deleteLifecycleState(input)

    return yield* listExtensionPackagesView({ projectPaths: getWorkflowViewProjectPaths(input) })
  })
}
