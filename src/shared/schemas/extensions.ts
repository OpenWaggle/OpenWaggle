import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import { Schema, type SchemaType } from '@shared/schema'
import {
  extensionCapabilityDeclarationSchema,
  extensionContributionIdSchema,
  extensionContributionsSchema,
  extensionRelativePathSchema,
} from './extension-contributions'
import { isNetworkOrigin } from './extension-network-origin'
import {
  isBuildCommand,
  isExtensionId,
  isNonEmptyTrimmed,
  isRuntimeRequirementBinary,
  isSemverVersion,
} from './extension-schema-primitives'

export type {
  ExtensionCapabilityDeclaration,
  ExtensionCommandContribution,
  ExtensionContributionRegistration,
  ExtensionContributions,
  ExtensionContributionUnregistration,
  ExtensionEntryContribution,
} from './extension-contributions'
export {
  extensionCapabilityDeclarationSchema,
  extensionCapabilityScopeSchema,
  extensionCommandContributionFamilySchema,
  extensionCommandContributionRegistrationSchema,
  extensionCommandContributionSchema,
  extensionContributionFamilySchema,
  extensionContributionIdSchema,
  extensionContributionRegistrationSchema,
  extensionContributionRuntimeSchema,
  extensionContributionsSchema,
  extensionContributionUnregistrationSchema,
  extensionExecutionPlacementSchema,
  extensionRelativePathSchema,
  extensionRouteContributionRegistrationSchema,
  extensionRouteContributionSchema,
  extensionSlotContributionFamilySchema,
  extensionSlotContributionRegistrationSchema,
  extensionSlotContributionSchema,
} from './extension-contributions'

const nonEmptyStringSchema = Schema.String.pipe(Schema.filter(isNonEmptyTrimmed))

export const extensionIdSchema = Schema.String.pipe(
  Schema.minLength(1),
  Schema.filter(isExtensionId),
)
export const extensionSemverVersionSchema = Schema.String.pipe(
  Schema.minLength(1),
  Schema.filter(isSemverVersion),
)
const extensionProposalHashSchema = Schema.String.pipe(
  Schema.length(OPENWAGGLE_EXTENSION.HASH.HEX_LENGTH),
)

export const extensionInstallSourceSchema = Schema.Literal(...OPENWAGGLE_EXTENSION.INSTALL_SOURCES)
export const extensionPackageWriteModeSchema = Schema.Literal('create', 'update')
export const extensionRuntimeRequirementTypeSchema = Schema.Literal(
  ...OPENWAGGLE_EXTENSION.RUNTIME_REQUIREMENT_TYPES,
)
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

export const extensionRuntimeRequirementSchema = Schema.Struct({
  id: extensionContributionIdSchema,
  label: nonEmptyStringSchema.pipe(Schema.maxLength(OPENWAGGLE_EXTENSION.LIMITS.NAME_MAX_LENGTH)),
  kind: Schema.optional(extensionRuntimeRequirementTypeSchema),
  command: Schema.optional(extensionRelativePathSchema),
  binary: Schema.optional(nonEmptyStringSchema.pipe(Schema.filter(isRuntimeRequirementBinary))),
}).pipe(
  Schema.filter((requirement) => {
    const hasBinary = requirement.binary !== undefined
    const hasCommand = requirement.command !== undefined

    if (hasBinary === hasCommand) {
      return 'Declare exactly one runtime requirement target: binary or command.'
    }
    if (
      hasBinary &&
      requirement.kind !== undefined &&
      requirement.kind !== OPENWAGGLE_EXTENSION.RUNTIME_REQUIREMENT_TYPE.BINARY
    ) {
      return 'Runtime requirement kind must be "binary" when binary is declared.'
    }
    if (
      hasCommand &&
      requirement.kind !== undefined &&
      requirement.kind !== OPENWAGGLE_EXTENSION.RUNTIME_REQUIREMENT_TYPE.COMMAND
    ) {
      return 'Runtime requirement kind must be "command" when command is declared.'
    }

    return true
  }),
)

export const extensionNetworkSchema = Schema.Struct({
  origins: Schema.mutable(Schema.Array(nonEmptyStringSchema.pipe(Schema.filter(isNetworkOrigin)))),
})

export const extensionInstallSchema = Schema.Struct({
  source: extensionInstallSourceSchema,
})

export const extensionBuildSchema = Schema.Struct({
  command: nonEmptyStringSchema.pipe(Schema.filter(isBuildCommand)),
  outputs: Schema.optional(Schema.mutable(Schema.Array(extensionRelativePathSchema))),
})

export const extensionDocsTopicDeclarationSchema = Schema.Struct({
  id: extensionContributionIdSchema,
  title: nonEmptyStringSchema.pipe(Schema.maxLength(OPENWAGGLE_EXTENSION.LIMITS.NAME_MAX_LENGTH)),
  path: extensionRelativePathSchema,
  description: Schema.optional(
    nonEmptyStringSchema.pipe(Schema.maxLength(OPENWAGGLE_EXTENSION.LIMITS.DESCRIPTION_MAX_LENGTH)),
  ),
  aliases: Schema.optional(Schema.mutable(Schema.Array(nonEmptyStringSchema))),
  keywords: Schema.optional(Schema.mutable(Schema.Array(nonEmptyStringSchema))),
})

export const extensionDocsSchema = Schema.Struct({
  topics: Schema.optional(Schema.mutable(Schema.Array(extensionDocsTopicDeclarationSchema))),
})

export const openWaggleExtensionManifestSchema = Schema.Struct({
  manifestVersion: Schema.Literal(1),
  id: extensionIdSchema,
  name: nonEmptyStringSchema.pipe(Schema.maxLength(OPENWAGGLE_EXTENSION.LIMITS.NAME_MAX_LENGTH)),
  version: extensionSemverVersionSchema,
  description: Schema.optional(
    nonEmptyStringSchema.pipe(Schema.maxLength(OPENWAGGLE_EXTENSION.LIMITS.DESCRIPTION_MAX_LENGTH)),
  ),
  sdk: Schema.Struct({
    openwaggle: nonEmptyStringSchema,
  }),
  sourceFiles: Schema.mutable(Schema.Array(extensionRelativePathSchema)),
  builtArtifacts: Schema.mutable(Schema.Array(extensionRelativePathSchema)),
  install: Schema.optional(extensionInstallSchema),
  build: Schema.optional(extensionBuildSchema),
  docs: Schema.optional(extensionDocsSchema),
  network: Schema.optional(extensionNetworkSchema),
  capabilities: Schema.optional(Schema.mutable(Schema.Array(extensionCapabilityDeclarationSchema))),
  contributions: Schema.optional(extensionContributionsSchema),
  pi: Schema.optional(
    Schema.Struct({
      resourceRoots: Schema.optional(Schema.mutable(Schema.Array(extensionRelativePathSchema))),
    }),
  ),
  trusted: Schema.optional(
    Schema.Struct({
      main: Schema.optional(extensionRelativePathSchema),
      renderer: Schema.optional(extensionRelativePathSchema),
    }),
  ),
  runtimeRequirements: Schema.optional(
    Schema.mutable(Schema.Array(extensionRuntimeRequirementSchema)),
  ),
})

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

export type OpenWaggleExtensionManifest = SchemaType<typeof openWaggleExtensionManifestSchema>
export type ExtensionDocsTopicDeclaration = SchemaType<typeof extensionDocsTopicDeclarationSchema>
