import * as Schema from 'effect/Schema'
import { OPENWAGGLE_EXTENSION } from './constants.js'
import {
  extensionCapabilityScopeSchema,
  extensionCommandContributionFamilySchema,
  extensionContributionEntryPathSchema,
  extensionContributionFamilySchema,
  extensionContributionIdSchema,
  extensionContributionRuntimeSchema,
  extensionExecutionPlacementSchema,
  extensionNonEmptyStringSchema,
  extensionSlotContributionFamilySchema,
  validateBrokerCapabilityDeclaration,
} from './manifest-primitives.js'
import type { SchemaType } from './schema.js'

export const extensionCapabilityDeclarationSchema = Schema.Struct({
  id: extensionContributionIdSchema,
  methods: Schema.optional(Schema.Array(extensionContributionIdSchema)),
  scopes: Schema.optional(Schema.Array(extensionCapabilityScopeSchema)),
}).pipe(Schema.filter(validateBrokerCapabilityDeclaration))

const brokerBindingSchema = {
  capability: Schema.optional(extensionContributionIdSchema),
  method: Schema.optional(extensionContributionIdSchema),
  methods: Schema.optional(Schema.Array(extensionContributionIdSchema)),
}
const targetSchema = Schema.Struct({
  projectPaths: Schema.optional(Schema.Array(extensionNonEmptyStringSchema)),
  sessionIds: Schema.optional(Schema.Array(extensionNonEmptyStringSchema)),
})
const matchSchema = Schema.Struct({
  toolNames: Schema.optional(Schema.Array(extensionNonEmptyStringSchema)),
  customMessageNames: Schema.optional(Schema.Array(extensionNonEmptyStringSchema)),
  interactionKinds: Schema.optional(Schema.Array(extensionNonEmptyStringSchema)),
})

function validateEntryRuntime(input: {
  readonly runtime: (typeof OPENWAGGLE_EXTENSION.CONTRIBUTION_RUNTIMES)[number]
  readonly execution: (typeof OPENWAGGLE_EXTENSION.EXECUTION_PLACEMENTS)[number]
}) {
  return (
    input.runtime !== OPENWAGGLE_EXTENSION.CONTRIBUTION_RUNTIME.TRUSTED_RENDERER ||
    input.execution === OPENWAGGLE_EXTENSION.EXECUTION_PLACEMENT.HOST_RENDERER ||
    'Trusted renderer contributions must execute in the host renderer.'
  )
}

export const extensionCommandContributionSchema = Schema.Struct({
  id: extensionContributionIdSchema,
  title: extensionNonEmptyStringSchema.pipe(
    Schema.maxLength(OPENWAGGLE_EXTENSION.LIMITS.NAME_MAX_LENGTH),
  ),
  category: Schema.optional(
    extensionNonEmptyStringSchema.pipe(
      Schema.maxLength(OPENWAGGLE_EXTENSION.LIMITS.NAME_MAX_LENGTH),
    ),
  ),
  target: Schema.optional(targetSchema),
  ...brokerBindingSchema,
})

export const extensionRouteContributionSchema = Schema.Struct({
  id: extensionContributionIdSchema,
  title: extensionNonEmptyStringSchema.pipe(
    Schema.maxLength(OPENWAGGLE_EXTENSION.LIMITS.NAME_MAX_LENGTH),
  ),
  runtime: extensionContributionRuntimeSchema,
  execution: extensionExecutionPlacementSchema,
  entry: extensionContributionEntryPathSchema,
  target: Schema.optional(targetSchema),
  matches: Schema.optional(matchSchema),
  ...brokerBindingSchema,
}).pipe(Schema.filter(validateEntryRuntime))

export const extensionSlotContributionSchema = extensionRouteContributionSchema

export const extensionContributionsSchema = Schema.Struct({
  commands: Schema.optional(Schema.Array(extensionCommandContributionSchema)),
  slashCommands: Schema.optional(Schema.Array(extensionCommandContributionSchema)),
  routes: Schema.optional(Schema.Array(extensionRouteContributionSchema)),
  settingsSections: Schema.optional(Schema.Array(extensionSlotContributionSchema)),
  sidePanels: Schema.optional(Schema.Array(extensionSlotContributionSchema)),
  dialogs: Schema.optional(Schema.Array(extensionSlotContributionSchema)),
  transcriptRenderers: Schema.optional(Schema.Array(extensionSlotContributionSchema)),
  toolRenderers: Schema.optional(Schema.Array(extensionSlotContributionSchema)),
  customMessageRenderers: Schema.optional(Schema.Array(extensionSlotContributionSchema)),
  interactionRenderers: Schema.optional(Schema.Array(extensionSlotContributionSchema)),
  statusWidgets: Schema.optional(Schema.Array(extensionSlotContributionSchema)),
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
