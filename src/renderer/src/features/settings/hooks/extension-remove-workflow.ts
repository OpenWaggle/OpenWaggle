import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import type {
  ExtensionApplyPackageRemoveInput,
  ExtensionManagerView,
  ExtensionPackageSummary,
} from '@shared/types/extensions'
import { api } from '@/shared/lib/ipc'
import {
  describeExtensionControllerError,
  logMutationFailure,
  packageScopeToMutationScope,
} from './extensions-section-controller-model'

const REMOVE_WORKFLOW_ACTOR = {
  kind: 'user',
  userId: 'settings',
} as const

interface RunApprovedExtensionRemoveWorkflowInput {
  readonly extensionPackage: ExtensionPackageSummary
  readonly projectPaths: readonly string[]
  readonly resetMutations: () => void
  readonly applyRemove: (input: ExtensionApplyPackageRemoveInput) => Promise<ExtensionManagerView>
  readonly refreshProviderModels: () => Promise<void>
  readonly setActionError: (message: string | null) => void
}

export async function runApprovedExtensionRemoveWorkflow(
  input: RunApprovedExtensionRemoveWorkflowInput,
) {
  const { extensionPackage, projectPaths } = input
  const scope = packageScopeToMutationScope(extensionPackage)
  input.resetMutations()
  input.setActionError(null)

  try {
    const proposal = await api.proposeExtensionPackageRemove({
      extensionId: extensionPackage.id,
      scope,
      viewProjectPaths: projectPaths,
      actor: REMOVE_WORKFLOW_ACTOR,
    })
    const title = extensionPackage.manifest?.name ?? extensionPackage.id
    const confirmed = await api.showConfirm(
      `Remove ${title}?`,
      proposal.requiresGlobalConfirmation
        ? 'This deletes the global extension package, unregisters its contributions, revokes runtime access, clears trust and enablement pins, and affects every project unless reinstalled.'
        : 'This deletes the extension package, unregisters its contributions, revokes runtime access, and clears trust and enablement pins. Extension-owned storage is not deleted.',
    )

    if (!confirmed) {
      return
    }

    const globalConfirmation = proposal.requiresGlobalConfirmation
      ? {
          globalConfirmation: {
            confirmed: true,
            confirmedExtensionId: proposal.extensionId,
            confirmedProposalHash: proposal.proposalHash,
            risk:
              proposal.globalConfirmationRisk ??
              OPENWAGGLE_EXTENSION.PACKAGE_WORKFLOW.GLOBAL_CONFIRMATION_RISK,
          },
        }
      : {}

    await input.applyRemove({
      extensionId: extensionPackage.id,
      scope,
      viewProjectPaths: projectPaths,
      actor: REMOVE_WORKFLOW_ACTOR,
      userApproval: {
        approved: true,
        approvedProposalHash: proposal.proposalHash,
        approvedBy: 'settings',
        approvedAt: Date.now(),
      },
      ...globalConfirmation,
    })
    await input.refreshProviderModels()
  } catch (error) {
    input.setActionError(describeExtensionControllerError(error))
    logMutationFailure({
      action: 'remove',
      extensionPackage,
      projectPath: null,
      viewProjectPaths: projectPaths,
      error,
    })
  }
}
