import type {
  ExtensionDocsTopicDeclaration as PublicExtensionDocsTopicDeclaration,
  OpenWaggleExtensionManifest as PublicOpenWaggleExtensionManifest,
} from '@openwaggle/extension-sdk'
import { openWaggleExtensionManifestSchema as publicOpenWaggleExtensionManifestSchema } from '@openwaggle/extension-sdk/internal/manifest-schemas'
import { extensionIdSchema } from '@openwaggle/extension-sdk/internal/manifest-primitives'
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
  extensionContributionIdSchema,
  extensionContributionRegistrationSchema,
  extensionContributionUnregistrationSchema,
} from './extension-contributions'

const nonEmptyStringSchema = Schema.String.pipe(Schema.filter(isNonEmptyTrimmed))

/*
 * The extension lifecycle and package-workflow requests the window and agents send (ADR 0040).
 * Each schema is the one source of its type in `@shared/types/extension-package-scope`,
 * `extension-package-workflow`, `extensions` and `extension-contribution-registry`; the Host
 * decodes the request with it before normalizing its project paths.
 */

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

const extensionViewProjectPathsSchema = Schema.Array(nonEmptyStringSchema)

export const extensionListPackagesInputSchema = Schema.Struct({
  projectPaths: Schema.optionalWith(extensionViewProjectPathsSchema, { exact: true }),
})

export const extensionListContributionsInputSchema = Schema.Struct({
  projectPaths: Schema.optionalWith(extensionViewProjectPathsSchema, { exact: true }),
  sessionId: Schema.optionalWith(nonEmptyStringSchema, { exact: true }),
})

/** What a runtime module request must prove before the Host serves an extension's module. */
export const extensionRuntimeModuleAccessInputSchema = Schema.Struct({
  packagePath: Schema.String.pipe(Schema.minLength(1)),
  contentHash: Schema.String.pipe(Schema.minLength(1)),
  projectPaths: Schema.Array(Schema.String.pipe(Schema.minLength(1))),
  sessionId: Schema.optionalWith(Schema.String.pipe(Schema.minLength(1)), { exact: true }),
})

export const extensionPackageWorkflowActorSchema = Schema.Union(
  Schema.Struct({
    kind: Schema.Literal('agent'),
    agentId: nonEmptyStringSchema,
    sessionId: Schema.optionalWith(nonEmptyStringSchema, { exact: true }),
  }),
  Schema.Struct({
    kind: Schema.Literal('user'),
    userId: Schema.optionalWith(nonEmptyStringSchema, { exact: true }),
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

/** The package a lifecycle request acts on, and the projects the caller's view shows. */
const lifecycleTargetFields = {
  extensionId: extensionIdSchema,
  scope: extensionLifecycleScopeSchema,
  viewProjectPaths: Schema.optionalWith(extensionViewProjectPathsSchema, { exact: true }),
}

export const extensionLifecycleMutationTargetSchema = Schema.Struct(lifecycleTargetFields)

const packageWriteFields = {
  ...lifecycleTargetFields,
  mode: extensionPackageWriteModeSchema,
  files: Schema.Array(extensionPackageFileWriteSchema),
  actor: extensionPackageWorkflowActorSchema,
}

const approvalFields = {
  userApproval: extensionPackageWorkflowUserApprovalSchema,
  globalConfirmation: Schema.optionalWith(extensionPackageWorkflowGlobalConfirmationSchema, {
    exact: true,
  }),
}

export const extensionProposePackageWriteInputSchema = Schema.Struct(packageWriteFields)

export const extensionApplyPackageWriteInputSchema = Schema.Struct({
  ...packageWriteFields,
  ...approvalFields,
})

export const extensionProposePackageRemoveInputSchema = Schema.Struct({
  ...lifecycleTargetFields,
  actor: extensionPackageWorkflowActorSchema,
})

export const extensionApplyPackageRemoveInputSchema = Schema.Struct({
  ...lifecycleTargetFields,
  actor: extensionPackageWorkflowActorSchema,
  ...approvalFields,
})

export const openWaggleExtensionManifestSchema = publicOpenWaggleExtensionManifestSchema

export const extensionSetTrustedInputSchema = Schema.Struct({
  ...lifecycleTargetFields,
  trusted: Schema.Boolean,
})

export const extensionSetEnabledInputSchema = Schema.Struct({
  ...lifecycleTargetFields,
  enabled: Schema.Boolean,
})

export const extensionSetProjectDisabledInputSchema = Schema.Struct({
  ...lifecycleTargetFields,
  projectPath: nonEmptyStringSchema,
  disabled: Schema.Boolean,
})

export const extensionAcceptUpdateInputSchema = extensionLifecycleMutationTargetSchema
export const extensionApproveBuildInputSchema = extensionLifecycleMutationTargetSchema
export const extensionReloadInputSchema = extensionLifecycleMutationTargetSchema

export type OpenWaggleExtensionManifest = PublicOpenWaggleExtensionManifest
export type ExtensionDocsTopicDeclaration = PublicExtensionDocsTopicDeclaration
