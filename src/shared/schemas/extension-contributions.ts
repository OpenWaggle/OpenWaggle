import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import { Schema, type SchemaType } from '@shared/schema'
import { validateBrokerCapabilityDeclaration } from './extension-broker-capability-methods'
import {
  isContributionId,
  isNonEmptyTrimmed,
  isPortableRelativePath,
} from './extension-schema-primitives'

const nonEmptyStringSchema = Schema.String.pipe(Schema.filter(isNonEmptyTrimmed))

function isNotRuntimeModuleContextEntryPath(value: string) {
  const [firstSegment] = value
    .replaceAll(
      OPENWAGGLE_EXTENSION.PATH.WINDOWS_SEPARATOR,
      OPENWAGGLE_EXTENSION.PATH.POSIX_SEPARATOR,
    )
    .split(OPENWAGGLE_EXTENSION.PATH.POSIX_SEPARATOR)

  return (
    firstSegment !== OPENWAGGLE_EXTENSION.RUNTIME_MODULE_PROTOCOL.MODULE_CONTEXT_SEGMENT ||
    `Must not start with the reserved "${OPENWAGGLE_EXTENSION.RUNTIME_MODULE_PROTOCOL.MODULE_CONTEXT_SEGMENT}" runtime module path segment.`
  )
}

export const extensionContributionIdSchema = Schema.String.pipe(
  Schema.minLength(1),
  Schema.filter(isContributionId),
)
export const extensionRelativePathSchema = Schema.String.pipe(
  Schema.minLength(1),
  Schema.filter(isPortableRelativePath),
)
const extensionContributionEntryPathSchema = extensionRelativePathSchema.pipe(
  Schema.filter(isNotRuntimeModuleContextEntryPath),
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
export const extensionCommandContributionFamilySchema = Schema.Literal(
  ...OPENWAGGLE_EXTENSION.COMMAND_CONTRIBUTION_FAMILIES,
)
export const extensionSlotContributionFamilySchema = Schema.Literal(
  ...OPENWAGGLE_EXTENSION.SLOT_CONTRIBUTION_FAMILIES,
)

export const extensionCapabilityDeclarationSchema = Schema.Struct({
  id: extensionContributionIdSchema,
  methods: Schema.optional(Schema.mutable(Schema.Array(extensionContributionIdSchema))),
  scopes: Schema.optional(Schema.mutable(Schema.Array(extensionCapabilityScopeSchema))),
}).pipe(Schema.filter(validateBrokerCapabilityDeclaration))

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
  entry: extensionContributionEntryPathSchema,
  ...extensionContributionTargetBindingSchema,
  ...extensionContributionMatchBindingSchema,
  ...extensionContributionBrokerBindingSchema,
})

export const extensionSlotContributionSchema = Schema.Struct({
  id: extensionContributionIdSchema,
  title: nonEmptyStringSchema.pipe(Schema.maxLength(OPENWAGGLE_EXTENSION.LIMITS.NAME_MAX_LENGTH)),
  runtime: extensionContributionRuntimeSchema,
  execution: extensionExecutionPlacementSchema,
  entry: extensionContributionEntryPathSchema,
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

export const extensionCommandContributionRegistrationSchema = Schema.Struct({
  family: extensionCommandContributionFamilySchema,
  contribution: extensionCommandContributionSchema,
})

export const extensionRouteContributionRegistrationSchema = Schema.Struct({
  family: Schema.Literal(OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.ROUTES),
  contribution: extensionRouteContributionSchema,
})

export const extensionSlotContributionRegistrationSchema = Schema.Struct({
  family: extensionSlotContributionFamilySchema,
  contribution: extensionSlotContributionSchema,
})

export const extensionContributionRegistrationSchema = Schema.Union(
  extensionCommandContributionRegistrationSchema,
  extensionRouteContributionRegistrationSchema,
  extensionSlotContributionRegistrationSchema,
)

export const extensionContributionUnregistrationSchema = Schema.Struct({
  family: extensionContributionFamilySchema,
  contributionId: extensionContributionIdSchema,
})

export type ExtensionCapabilityDeclaration = SchemaType<typeof extensionCapabilityDeclarationSchema>
export type ExtensionCommandContribution = SchemaType<typeof extensionCommandContributionSchema>
export type ExtensionContributions = SchemaType<typeof extensionContributionsSchema>
export type ExtensionContributionRegistration = SchemaType<
  typeof extensionContributionRegistrationSchema
>
export type ExtensionContributionUnregistration = SchemaType<
  typeof extensionContributionUnregistrationSchema
>
export type ExtensionEntryContribution =
  | SchemaType<typeof extensionRouteContributionSchema>
  | SchemaType<typeof extensionSlotContributionSchema>
