import type { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import type {
  ExtensionLifecycleMutationTarget,
  ExtensionPackageLifecycleScope,
} from './extension-package-scope'

export type ExtensionPackageWriteMode = 'create' | 'update'
export type ExtensionPackageWriteOperation = 'write:create' | 'write:update'
export type ExtensionPackageRemoveOperation = 'remove'

export interface ExtensionPackageFileWrite {
  readonly relativePath: string
  readonly content: string
}

export type ExtensionPackageWorkflowActor =
  | {
      readonly kind: 'agent'
      readonly agentId: string
      readonly sessionId?: string
    }
  | {
      readonly kind: 'user'
      readonly userId?: string
    }
  | {
      readonly kind: 'extension'
      readonly extensionId: string
    }

export interface ExtensionPackageWorkflowUserApproval {
  readonly approved: boolean
  readonly approvedProposalHash: string
  readonly approvedBy: string
  readonly approvedAt: number
}

export interface ExtensionPackageWorkflowGlobalConfirmation {
  readonly confirmed: boolean
  readonly confirmedExtensionId: string
  readonly confirmedProposalHash: string
  readonly risk: typeof OPENWAGGLE_EXTENSION.PACKAGE_WORKFLOW.GLOBAL_CONFIRMATION_RISK
}

export interface ExtensionProposePackageWriteInput extends ExtensionLifecycleMutationTarget {
  readonly mode: ExtensionPackageWriteMode
  readonly files: readonly ExtensionPackageFileWrite[]
  readonly actor: ExtensionPackageWorkflowActor
}

export interface ExtensionApplyPackageWriteInput extends ExtensionProposePackageWriteInput {
  readonly userApproval: ExtensionPackageWorkflowUserApproval
  readonly globalConfirmation?: ExtensionPackageWorkflowGlobalConfirmation
}

export interface ExtensionProposePackageRemoveInput extends ExtensionLifecycleMutationTarget {
  readonly actor: ExtensionPackageWorkflowActor
}

export interface ExtensionApplyPackageRemoveInput extends ExtensionProposePackageRemoveInput {
  readonly userApproval: ExtensionPackageWorkflowUserApproval
  readonly globalConfirmation?: ExtensionPackageWorkflowGlobalConfirmation
}

export interface ExtensionPackageWriteProposalFileView {
  readonly relativePath: string
  readonly byteLength: number
  readonly contentHash: string
}

export interface ExtensionPackageWriteProposalView {
  readonly extensionId: string
  readonly scope: ExtensionPackageLifecycleScope
  readonly mode: ExtensionPackageWriteMode
  readonly operation: ExtensionPackageWriteOperation
  readonly actor: ExtensionPackageWorkflowActor
  readonly proposalHash: string
  readonly files: readonly ExtensionPackageWriteProposalFileView[]
  readonly fileCount: number
  readonly totalBytes: number
  readonly requiresGlobalConfirmation: boolean
  readonly globalConfirmationRisk:
    | typeof OPENWAGGLE_EXTENSION.PACKAGE_WORKFLOW.GLOBAL_CONFIRMATION_RISK
    | null
}

export interface ExtensionPackageRemoveProposalView {
  readonly extensionId: string
  readonly scope: ExtensionPackageLifecycleScope
  readonly operation: ExtensionPackageRemoveOperation
  readonly actor: ExtensionPackageWorkflowActor
  readonly proposalHash: string
  readonly requiresGlobalConfirmation: boolean
  readonly globalConfirmationRisk:
    | typeof OPENWAGGLE_EXTENSION.PACKAGE_WORKFLOW.GLOBAL_CONFIRMATION_RISK
    | null
}
