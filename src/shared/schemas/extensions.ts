import {
  extensionIdSchema,
  type ExtensionDocsTopicDeclaration as PublicExtensionDocsTopicDeclaration,
  type OpenWaggleExtensionManifest as PublicOpenWaggleExtensionManifest,
  openWaggleExtensionManifestSchema as publicOpenWaggleExtensionManifestSchema,
} from '@openwaggle/extension-sdk'
import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import { Schema } from '@shared/schema'
import { extensionRelativePathSchema } from './extension-contributions'
import { isNonEmptyTrimmed } from './extension-schema-primitives'

export type {
  ExtensionCapabilityDeclaration,
  ExtensionContributionRegistration,
  ExtensionContributions,
  ExtensionContributionUnregistration,
  ExtensionSessionSummaryContribution,
  ExtensionSidePanelIcon,
} from './extension-contributions'
export {
  extensionContributionFamilySchema,
  extensionContributionIdSchema,
  extensionContributionRegistrationSchema,
  extensionContributionUnregistrationSchema,
} from './extension-contributions'

const nonEmptyStringSchema = Schema.String.pipe(Schema.filter(isNonEmptyTrimmed))

// The manifest's id rule is the public SDK's.
export { extensionIdSchema }

const extensionProposalHashSchema = Schema.String.pipe(
  Schema.length(OPENWAGGLE_EXTENSION.HASH.HEX_LENGTH),
)
export const extensionPackageWriteModeSchema = Schema.Literal('create', 'update')
export const extensionLifecycleScopeSchema = Schema.Union(
  Schema.Struct({
    kind: Schema.Literal(OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND),
  }),
  Schema.Struct({
    kind: Schema.Literal(OPENWAGGLE_EXTENSION.SCOPE.PROJECT_KIND),
    projectPath: nonEmptyStringSchema,
  }),
)

const extensionViewProjectPathsSchema = Schema.mutable(Schema.Array(nonEmptyStringSchema))

export const extensionListPackagesInputSchema = Schema.Struct({
  projectPaths: Schema.optional(extensionViewProjectPathsSchema),
})

export const extensionListContributionsInputSchema = Schema.Struct({
  projectPaths: Schema.optional(extensionViewProjectPathsSchema),
  sessionId: Schema.optional(nonEmptyStringSchema),
})

export const extensionPackageWorkflowActorSchema = Schema.Union(
  Schema.Struct({
    kind: Schema.Literal('agent'),
    agentId: nonEmptyStringSchema,
    sessionId: Schema.optional(nonEmptyStringSchema),
  }),
  Schema.Struct({
    kind: Schema.Literal('user'),
    userId: Schema.optional(nonEmptyStringSchema),
  }),
  Schema.Struct({
    kind: Schema.Literal('extension'),
    extensionId: extensionIdSchema,
  }),
)

export const extensionPackageFileWriteSchema = Schema.Struct({
  relativePath: extensionRelativePathSchema,
  content: Schema.String,
})

export const extensionPackageWorkflowUserApprovalSchema = Schema.Struct({
  approved: Schema.Boolean,
  approvedProposalHash: extensionProposalHashSchema,
  approvedBy: nonEmptyStringSchema,
  approvedAt: Schema.Number,
})

export const extensionPackageWorkflowGlobalConfirmationSchema = Schema.Struct({
  confirmed: Schema.Boolean,
  confirmedExtensionId: extensionIdSchema,
  confirmedProposalHash: extensionProposalHashSchema,
  risk: Schema.Literal(OPENWAGGLE_EXTENSION.PACKAGE_WORKFLOW.GLOBAL_CONFIRMATION_RISK),
})

export const extensionProposePackageWriteInputSchema = Schema.Struct({
  extensionId: extensionIdSchema,
  scope: extensionLifecycleScopeSchema,
  viewProjectPaths: Schema.optional(extensionViewProjectPathsSchema),
  mode: extensionPackageWriteModeSchema,
  files: Schema.mutable(Schema.Array(extensionPackageFileWriteSchema)),
  actor: extensionPackageWorkflowActorSchema,
})

export const extensionApplyPackageWriteInputSchema = Schema.Struct({
  extensionId: extensionIdSchema,
  scope: extensionLifecycleScopeSchema,
  viewProjectPaths: Schema.optional(extensionViewProjectPathsSchema),
  mode: extensionPackageWriteModeSchema,
  files: Schema.mutable(Schema.Array(extensionPackageFileWriteSchema)),
  actor: extensionPackageWorkflowActorSchema,
  userApproval: extensionPackageWorkflowUserApprovalSchema,
  globalConfirmation: Schema.optional(extensionPackageWorkflowGlobalConfirmationSchema),
})

export const extensionProposePackageRemoveInputSchema = Schema.Struct({
  extensionId: extensionIdSchema,
  scope: extensionLifecycleScopeSchema,
  viewProjectPaths: Schema.optional(extensionViewProjectPathsSchema),
  actor: extensionPackageWorkflowActorSchema,
})

export const extensionApplyPackageRemoveInputSchema = Schema.Struct({
  extensionId: extensionIdSchema,
  scope: extensionLifecycleScopeSchema,
  viewProjectPaths: Schema.optional(extensionViewProjectPathsSchema),
  actor: extensionPackageWorkflowActorSchema,
  userApproval: extensionPackageWorkflowUserApprovalSchema,
  globalConfirmation: Schema.optional(extensionPackageWorkflowGlobalConfirmationSchema),
})

export const openWaggleExtensionManifestSchema = publicOpenWaggleExtensionManifestSchema

export const extensionSetTrustedInputSchema = Schema.Struct({
  extensionId: extensionIdSchema,
  scope: extensionLifecycleScopeSchema,
  viewProjectPaths: Schema.optional(extensionViewProjectPathsSchema),
  trusted: Schema.Boolean,
})

export const extensionSetEnabledInputSchema = Schema.Struct({
  extensionId: extensionIdSchema,
  scope: extensionLifecycleScopeSchema,
  viewProjectPaths: Schema.optional(extensionViewProjectPathsSchema),
  enabled: Schema.Boolean,
})

export const extensionSetProjectDisabledInputSchema = Schema.Struct({
  extensionId: extensionIdSchema,
  scope: extensionLifecycleScopeSchema,
  viewProjectPaths: Schema.optional(extensionViewProjectPathsSchema),
  projectPath: nonEmptyStringSchema,
  disabled: Schema.Boolean,
})

export const extensionAcceptUpdateInputSchema = Schema.Struct({
  extensionId: extensionIdSchema,
  scope: extensionLifecycleScopeSchema,
  viewProjectPaths: Schema.optional(extensionViewProjectPathsSchema),
})

export const extensionApproveBuildInputSchema = Schema.Struct({
  extensionId: extensionIdSchema,
  scope: extensionLifecycleScopeSchema,
  viewProjectPaths: Schema.optional(extensionViewProjectPathsSchema),
})

export const extensionReloadInputSchema = Schema.Struct({
  extensionId: extensionIdSchema,
  scope: extensionLifecycleScopeSchema,
  viewProjectPaths: Schema.optional(extensionViewProjectPathsSchema),
})

export type OpenWaggleExtensionManifest = PublicOpenWaggleExtensionManifest
export type ExtensionDocsTopicDeclaration = PublicExtensionDocsTopicDeclaration
