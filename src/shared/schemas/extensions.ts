import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import { Schema, type SchemaType } from '@shared/schema'
import { isNetworkOrigin } from './extension-network-origin'
import {
  isBuildCommand,
  isContributionId,
  isExtensionId,
  isNonEmptyTrimmed,
  isPortableRelativePath,
  isRuntimeRequirementBinary,
  isSemverVersion,
} from './extension-schema-primitives'

const nonEmptyStringSchema = Schema.String.pipe(Schema.filter(isNonEmptyTrimmed))

export const extensionIdSchema = Schema.String.pipe(
  Schema.minLength(1),
  Schema.filter(isExtensionId),
)
export const extensionContributionIdSchema = Schema.String.pipe(
  Schema.minLength(1),
  Schema.filter(isContributionId),
)
export const extensionRelativePathSchema = Schema.String.pipe(
  Schema.minLength(1),
  Schema.filter(isPortableRelativePath),
)
export const extensionSemverVersionSchema = Schema.String.pipe(
  Schema.minLength(1),
  Schema.filter(isSemverVersion),
)

export const extensionCapabilityScopeSchema = Schema.Literal(
  ...OPENWAGGLE_EXTENSION.CAPABILITY_SCOPES,
)
export const extensionContributionRuntimeSchema = Schema.Literal(
  ...OPENWAGGLE_EXTENSION.CONTRIBUTION_RUNTIMES,
)
export const extensionExecutionPlacementSchema = Schema.Literal(
  ...OPENWAGGLE_EXTENSION.EXECUTION_PLACEMENTS,
)
export const extensionContributionFamilySchema = Schema.Literal(
  ...OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILIES,
)
export const extensionInstallSourceSchema = Schema.Literal(...OPENWAGGLE_EXTENSION.INSTALL_SOURCES)
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

export const extensionCapabilityDeclarationSchema = Schema.Struct({
  id: extensionContributionIdSchema,
  methods: Schema.optional(Schema.mutable(Schema.Array(extensionContributionIdSchema))),
  scopes: Schema.optional(Schema.mutable(Schema.Array(extensionCapabilityScopeSchema))),
})

const extensionContributionBrokerBindingSchema = {
  capability: Schema.optional(extensionContributionIdSchema),
  method: Schema.optional(extensionContributionIdSchema),
  methods: Schema.optional(Schema.mutable(Schema.Array(extensionContributionIdSchema))),
}

const extensionContributionTargetSchema = Schema.Struct({
  projectPaths: Schema.optional(Schema.mutable(Schema.Array(nonEmptyStringSchema))),
  sessionIds: Schema.optional(Schema.mutable(Schema.Array(nonEmptyStringSchema))),
})

const extensionContributionTargetBindingSchema = {
  target: Schema.optional(extensionContributionTargetSchema),
}

const extensionContributionMatchSchema = Schema.Struct({
  toolNames: Schema.optional(Schema.mutable(Schema.Array(nonEmptyStringSchema))),
  customMessageNames: Schema.optional(Schema.mutable(Schema.Array(nonEmptyStringSchema))),
  interactionKinds: Schema.optional(Schema.mutable(Schema.Array(nonEmptyStringSchema))),
})

const extensionContributionMatchBindingSchema = {
  matches: Schema.optional(extensionContributionMatchSchema),
}

export const extensionCommandContributionSchema = Schema.Struct({
  id: extensionContributionIdSchema,
  title: nonEmptyStringSchema.pipe(Schema.maxLength(OPENWAGGLE_EXTENSION.LIMITS.NAME_MAX_LENGTH)),
  category: Schema.optional(
    nonEmptyStringSchema.pipe(Schema.maxLength(OPENWAGGLE_EXTENSION.LIMITS.NAME_MAX_LENGTH)),
  ),
  ...extensionContributionTargetBindingSchema,
  ...extensionContributionBrokerBindingSchema,
})

export const extensionRouteContributionSchema = Schema.Struct({
  id: extensionContributionIdSchema,
  title: nonEmptyStringSchema.pipe(Schema.maxLength(OPENWAGGLE_EXTENSION.LIMITS.NAME_MAX_LENGTH)),
  runtime: extensionContributionRuntimeSchema,
  execution: extensionExecutionPlacementSchema,
  entry: extensionRelativePathSchema,
  ...extensionContributionTargetBindingSchema,
  ...extensionContributionMatchBindingSchema,
  ...extensionContributionBrokerBindingSchema,
})

export const extensionSlotContributionSchema = Schema.Struct({
  id: extensionContributionIdSchema,
  title: nonEmptyStringSchema.pipe(Schema.maxLength(OPENWAGGLE_EXTENSION.LIMITS.NAME_MAX_LENGTH)),
  runtime: extensionContributionRuntimeSchema,
  execution: extensionExecutionPlacementSchema,
  entry: extensionRelativePathSchema,
  ...extensionContributionTargetBindingSchema,
  ...extensionContributionMatchBindingSchema,
  ...extensionContributionBrokerBindingSchema,
})

export const extensionContributionsSchema = Schema.Struct({
  commands: Schema.optional(Schema.mutable(Schema.Array(extensionCommandContributionSchema))),
  slashCommands: Schema.optional(Schema.mutable(Schema.Array(extensionCommandContributionSchema))),
  routes: Schema.optional(Schema.mutable(Schema.Array(extensionRouteContributionSchema))),
  settingsSections: Schema.optional(Schema.mutable(Schema.Array(extensionSlotContributionSchema))),
  sidePanels: Schema.optional(Schema.mutable(Schema.Array(extensionSlotContributionSchema))),
  dialogs: Schema.optional(Schema.mutable(Schema.Array(extensionSlotContributionSchema))),
  transcriptRenderers: Schema.optional(
    Schema.mutable(Schema.Array(extensionSlotContributionSchema)),
  ),
  toolRenderers: Schema.optional(Schema.mutable(Schema.Array(extensionSlotContributionSchema))),
  customMessageRenderers: Schema.optional(
    Schema.mutable(Schema.Array(extensionSlotContributionSchema)),
  ),
  interactionRenderers: Schema.optional(
    Schema.mutable(Schema.Array(extensionSlotContributionSchema)),
  ),
  statusWidgets: Schema.optional(Schema.mutable(Schema.Array(extensionSlotContributionSchema))),
})

export const extensionRuntimeRequirementSchema = Schema.Struct({
  id: extensionContributionIdSchema,
  label: nonEmptyStringSchema.pipe(Schema.maxLength(OPENWAGGLE_EXTENSION.LIMITS.NAME_MAX_LENGTH)),
  command: Schema.optional(extensionRelativePathSchema),
  binary: Schema.optional(nonEmptyStringSchema.pipe(Schema.filter(isRuntimeRequirementBinary))),
})

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
export type ExtensionCapabilityDeclaration = SchemaType<typeof extensionCapabilityDeclarationSchema>
export type ExtensionContributions = SchemaType<typeof extensionContributionsSchema>
export type ExtensionDocsTopicDeclaration = SchemaType<typeof extensionDocsTopicDeclarationSchema>
