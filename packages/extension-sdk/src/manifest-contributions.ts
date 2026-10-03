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
  extensionLucideIconNameSchema,
  extensionNonEmptyStringSchema,
  extensionSvgIconPathSchema,
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

const entryContributionFields = {
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
}

export const extensionRouteContributionSchema = Schema.Struct(entryContributionFields).pipe(
  Schema.filter(validateEntryRuntime),
)

export const extensionSlotContributionSchema = extensionRouteContributionSchema

/**
 * A side panel's Panel rail icon: a bundled Lucide icon name in kebab-case, or a package-relative
 * single-colour `.svg` file. OpenWaggle uses only the icon's shape and paints it in its own colours.
 */
export const extensionSidePanelIconSchema = Schema.Union(
  extensionLucideIconNameSchema,
  Schema.Struct({ svg: extensionSvgIconPathSchema }).annotations({
    parseOptions: { onExcessProperty: 'error' },
  }),
)

export const extensionSidePanelContributionSchema = Schema.Struct({
  ...entryContributionFields,
  icon: Schema.optional(extensionSidePanelIconSchema),
}).pipe(Schema.filter(validateEntryRuntime))

export const extensionSessionSummaryActionSchema = Schema.Struct({
  family: Schema.Literal('commands', 'sidePanels', 'dialogs'),
  contributionId: extensionContributionIdSchema,
})

export const extensionSessionSummaryRowSchema = Schema.Struct({
  id: extensionContributionIdSchema,
  label: extensionNonEmptyStringSchema.pipe(
    Schema.maxLength(OPENWAGGLE_EXTENSION.LIMITS.NAME_MAX_LENGTH),
  ),
  value: Schema.optional(
    extensionNonEmptyStringSchema.pipe(
      Schema.maxLength(OPENWAGGLE_EXTENSION.LIMITS.DESCRIPTION_MAX_LENGTH),
    ),
  ),
  badge: Schema.optional(
    extensionNonEmptyStringSchema.pipe(
      Schema.maxLength(OPENWAGGLE_EXTENSION.LIMITS.NAME_MAX_LENGTH),
    ),
  ),
  count: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.nonNegative())),
  resourceId: Schema.optional(extensionContributionIdSchema),
  action: Schema.optional(extensionSessionSummaryActionSchema),
}).pipe(
  Schema.filter(
    (row) =>
      row.resourceId === undefined ||
      row.action === undefined ||
      'Session Summary rows cannot declare both resourceId and action.',
  ),
)

const SESSION_SUMMARY_AUTO_COLLAPSE_MIN_MS = 1_000
const SESSION_SUMMARY_AUTO_COLLAPSE_MAX_MS = 300_000

export const extensionSessionSummaryDisclosureSchema = Schema.Struct({
  defaultExpanded: Schema.optional(Schema.Boolean),
  collapsible: Schema.optional(Schema.Boolean),
  autoCollapseAfterMs: Schema.optional(
    Schema.Number.pipe(
      Schema.int(),
      Schema.greaterThanOrEqualTo(SESSION_SUMMARY_AUTO_COLLAPSE_MIN_MS),
      Schema.lessThanOrEqualTo(SESSION_SUMMARY_AUTO_COLLAPSE_MAX_MS),
    ),
  ),
})

const extensionSessionSummaryStateMessageSchema = extensionNonEmptyStringSchema.pipe(
  Schema.maxLength(OPENWAGGLE_EXTENSION.LIMITS.DESCRIPTION_MAX_LENGTH),
)

export const extensionSessionSummaryStateSchema = Schema.Union(
  Schema.Struct({ status: Schema.Literal('ready') }),
  Schema.Struct({
    status: Schema.Literal('loading', 'live'),
    message: Schema.optional(extensionSessionSummaryStateMessageSchema),
  }),
  Schema.Struct({
    status: Schema.Literal('failure'),
    message: extensionSessionSummaryStateMessageSchema,
  }),
)

export const extensionSessionSummaryContributionSchema = Schema.Struct({
  id: extensionContributionIdSchema,
  title: extensionNonEmptyStringSchema.pipe(
    Schema.maxLength(OPENWAGGLE_EXTENSION.LIMITS.NAME_MAX_LENGTH),
  ),
  placement: Schema.optional(Schema.Literal('context', 'coordination', 'details')),
  target: Schema.optional(targetSchema),
  disclosure: Schema.optional(extensionSessionSummaryDisclosureSchema),
  state: Schema.optional(extensionSessionSummaryStateSchema),
  rows: Schema.Array(extensionSessionSummaryRowSchema),
})

export const extensionContributionsSchema = Schema.Struct({
  commands: Schema.optional(Schema.Array(extensionCommandContributionSchema)),
  slashCommands: Schema.optional(Schema.Array(extensionCommandContributionSchema)),
  routes: Schema.optional(Schema.Array(extensionRouteContributionSchema)),
  settingsSections: Schema.optional(Schema.Array(extensionSlotContributionSchema)),
  sidePanels: Schema.optional(Schema.Array(extensionSidePanelContributionSchema)),
  dialogs: Schema.optional(Schema.Array(extensionSlotContributionSchema)),
  transcriptRenderers: Schema.optional(Schema.Array(extensionSlotContributionSchema)),
  toolRenderers: Schema.optional(Schema.Array(extensionSlotContributionSchema)),
  customMessageRenderers: Schema.optional(Schema.Array(extensionSlotContributionSchema)),
  interactionRenderers: Schema.optional(Schema.Array(extensionSlotContributionSchema)),
  statusWidgets: Schema.optional(Schema.Array(extensionSlotContributionSchema)),
  sessionSummarySections: Schema.optional(Schema.Array(extensionSessionSummaryContributionSchema)),
})

export const extensionCommandContributionRegistrationSchema = Schema.Struct({
  family: extensionCommandContributionFamilySchema,
  contribution: extensionCommandContributionSchema,
})
export const extensionRouteContributionRegistrationSchema = Schema.Struct({
  family: Schema.Literal(OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.ROUTES),
  contribution: extensionRouteContributionSchema,
})
export const extensionSidePanelContributionRegistrationSchema = Schema.Struct({
  family: Schema.Literal(OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.SIDE_PANELS),
  contribution: extensionSidePanelContributionSchema,
})
const { CONTRIBUTION_FAMILY } = OPENWAGGLE_EXTENSION

/**
 * Side panels register only through the side panel schema, so a side panel whose `icon` is invalid
 * is rejected instead of matching the slot schema with its icon silently stripped. Every other
 * slot contribution family registers here.
 */
export const extensionSlotContributionRegistrationSchema = Schema.Struct({
  family: Schema.Literal(
    CONTRIBUTION_FAMILY.SETTINGS_SECTIONS,
    CONTRIBUTION_FAMILY.DIALOGS,
    CONTRIBUTION_FAMILY.TRANSCRIPT_RENDERERS,
    CONTRIBUTION_FAMILY.TOOL_RENDERERS,
    CONTRIBUTION_FAMILY.CUSTOM_MESSAGE_RENDERERS,
    CONTRIBUTION_FAMILY.INTERACTION_RENDERERS,
    CONTRIBUTION_FAMILY.STATUS_WIDGETS,
  ),
  contribution: extensionSlotContributionSchema,
})
export const extensionSessionSummaryContributionRegistrationSchema = Schema.Struct({
  family: Schema.Literal(OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.SESSION_SUMMARY_SECTIONS),
  contribution: extensionSessionSummaryContributionSchema,
})
export const extensionContributionRegistrationSchema = Schema.Union(
  extensionCommandContributionRegistrationSchema,
  extensionRouteContributionRegistrationSchema,
  extensionSidePanelContributionRegistrationSchema,
  extensionSlotContributionRegistrationSchema,
  extensionSessionSummaryContributionRegistrationSchema,
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
export type ExtensionSidePanelIcon = SchemaType<typeof extensionSidePanelIconSchema>
export type ExtensionSidePanelContribution = SchemaType<typeof extensionSidePanelContributionSchema>
export type ExtensionEntryContribution =
  | SchemaType<typeof extensionRouteContributionSchema>
  | SchemaType<typeof extensionSlotContributionSchema>
  | ExtensionSidePanelContribution
export type ExtensionSessionSummaryContribution = SchemaType<
  typeof extensionSessionSummaryContributionSchema
>
