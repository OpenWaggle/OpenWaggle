import type { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import type { SchemaType } from '@shared/schema'
import type {
  extensionApplyPackageRemoveInputSchema,
  extensionApplyPackageWriteInputSchema,
  extensionPackageFileWriteSchema,
  extensionPackageWorkflowActorSchema,
  extensionPackageWorkflowGlobalConfirmationSchema,
  extensionPackageWorkflowUserApprovalSchema,
  extensionPackageWriteModeSchema,
  extensionProposePackageRemoveInputSchema,
  extensionProposePackageWriteInputSchema,
} from '@shared/schemas/extensions'
import type { ExtensionPackageLifecycleScope } from './extension-package-scope'

export type ExtensionPackageWriteMode = SchemaType<typeof extensionPackageWriteModeSchema>
export type ExtensionPackageWriteOperation = 'write:create' | 'write:update'
export type ExtensionPackageRemoveOperation = 'remove'

export type ExtensionPackageFileWrite = SchemaType<typeof extensionPackageFileWriteSchema>
export type ExtensionPackageWorkflowActor = SchemaType<typeof extensionPackageWorkflowActorSchema>
export type ExtensionPackageWorkflowUserApproval = SchemaType<
  typeof extensionPackageWorkflowUserApprovalSchema
>
export type ExtensionPackageWorkflowGlobalConfirmation = SchemaType<
  typeof extensionPackageWorkflowGlobalConfirmationSchema
>
export type ExtensionProposePackageWriteInput = SchemaType<
  typeof extensionProposePackageWriteInputSchema
>
export type ExtensionApplyPackageWriteInput = SchemaType<
  typeof extensionApplyPackageWriteInputSchema
>
export type ExtensionProposePackageRemoveInput = SchemaType<
  typeof extensionProposePackageRemoveInputSchema
>
export type ExtensionApplyPackageRemoveInput = SchemaType<
  typeof extensionApplyPackageRemoveInputSchema
>

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
