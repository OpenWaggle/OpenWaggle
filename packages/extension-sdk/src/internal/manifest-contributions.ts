import * as Schema from 'effect/Schema'
import { OPENWAGGLE_EXTENSION } from '../constants.js'
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
  brokerCapabilityMethodsRule,
} from './manifest-primitives.js'

export const extensionCapabilityDeclarationSchema = Schema.Struct({
  id: extensionContributionIdSchema,
  methods: Schema.optionalWith(Schema.Array(extensionContributionIdSchema), { exact: true }),
  scopes: Schema.optionalWith(Schema.Array(extensionCapabilityScopeSchema), { exact: true }),
}).pipe(Schema.filter(brokerCapabilityMethodsRule))

const brokerBindingSchema = {
  capability: Schema.optionalWith(extensionContributionIdSchema, { exact: true }),
  method: Schema.optionalWith(extensionContributionIdSchema, { exact: true }),
  methods: Schema.optionalWith(Schema.Array(extensionContributionIdSchema), { exact: true }),
}
export const extensionContributionTargetSchema = Schema.Struct({
  projectPaths: Schema.optionalWith(Schema.Array(extensionNonEmptyStringSchema), { exact: true }),
  sessionIds: Schema.optionalWith(Schema.Array(extensionNonEmptyStringSchema), { exact: true }),
})
export const extensionContributionMatchSchema = Schema.Struct({
  toolNames: Schema.optionalWith(Schema.Array(extensionNonEmptyStringSchema), { exact: true }),
  customMessageNames: Schema.optionalWith(Schema.Array(extensionNonEmptyStringSchema), {
    exact: true,
  }),
  interactionKinds: Schema.optionalWith(Schema.Array(extensionNonEmptyStringSchema), {
    exact: true,
  }),
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
  category: Schema.optionalWith(
    extensionNonEmptyStringSchema.pipe(
      Schema.maxLength(OPENWAGGLE_EXTENSION.LIMITS.NAME_MAX_LENGTH),
    ),
    { exact: true },
  ),
  target: Schema.optionalWith(extensionContributionTargetSchema, { exact: true }),
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
  target: Schema.optionalWith(extensionContributionTargetSchema, { exact: true }),
  matches: Schema.optionalWith(extensionContributionMatchSchema, { exact: true }),
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
  icon: Schema.optionalWith(extensionSidePanelIconSchema, { exact: true }),
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
  value: Schema.optionalWith(
    extensionNonEmptyStringSchema.pipe(
      Schema.maxLength(OPENWAGGLE_EXTENSION.LIMITS.DESCRIPTION_MAX_LENGTH),
    ),
    { exact: true },
  ),
  badge: Schema.optionalWith(
    extensionNonEmptyStringSchema.pipe(
      Schema.maxLength(OPENWAGGLE_EXTENSION.LIMITS.NAME_MAX_LENGTH),
    ),
    { exact: true },
  ),
  count: Schema.optionalWith(Schema.Number.pipe(Schema.int(), Schema.nonNegative()), {
    exact: true,
  }),
  resourceId: Schema.optionalWith(extensionContributionIdSchema, { exact: true }),
  action: Schema.optionalWith(extensionSessionSummaryActionSchema, { exact: true }),
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
  defaultExpanded: Schema.optionalWith(Schema.Boolean, { exact: true }),
  collapsible: Schema.optionalWith(Schema.Boolean, { exact: true }),
  autoCollapseAfterMs: Schema.optionalWith(
    Schema.Number.pipe(
      Schema.int(),
      Schema.greaterThanOrEqualTo(SESSION_SUMMARY_AUTO_COLLAPSE_MIN_MS),
      Schema.lessThanOrEqualTo(SESSION_SUMMARY_AUTO_COLLAPSE_MAX_MS),
    ),
    { exact: true },
  ),
})

const extensionSessionSummaryStateMessageSchema = extensionNonEmptyStringSchema.pipe(
  Schema.maxLength(OPENWAGGLE_EXTENSION.LIMITS.DESCRIPTION_MAX_LENGTH),
)

export const extensionSessionSummaryStateSchema = Schema.Union(
  Schema.Struct({ status: Schema.Literal('ready') }),
  Schema.Struct({
    status: Schema.Literal('loading', 'live'),
    message: Schema.optionalWith(extensionSessionSummaryStateMessageSchema, { exact: true }),
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
  placement: Schema.optionalWith(Schema.Literal('context', 'coordination', 'details'), {
    exact: true,
  }),
  target: Schema.optionalWith(extensionContributionTargetSchema, { exact: true }),
  disclosure: Schema.optionalWith(extensionSessionSummaryDisclosureSchema, { exact: true }),
  state: Schema.optionalWith(extensionSessionSummaryStateSchema, { exact: true }),
  rows: Schema.Array(extensionSessionSummaryRowSchema),
})

export const extensionContributionsSchema = Schema.Struct({
  commands: Schema.optionalWith(Schema.Array(extensionCommandContributionSchema), { exact: true }),
  slashCommands: Schema.optionalWith(Schema.Array(extensionCommandContributionSchema), {
    exact: true,
  }),
  routes: Schema.optionalWith(Schema.Array(extensionRouteContributionSchema), { exact: true }),
  settingsSections: Schema.optionalWith(Schema.Array(extensionSlotContributionSchema), {
    exact: true,
  }),
  sidePanels: Schema.optionalWith(Schema.Array(extensionSidePanelContributionSchema), {
    exact: true,
  }),
  dialogs: Schema.optionalWith(Schema.Array(extensionSlotContributionSchema), { exact: true }),
  transcriptRenderers: Schema.optionalWith(Schema.Array(extensionSlotContributionSchema), {
    exact: true,
  }),
  toolRenderers: Schema.optionalWith(Schema.Array(extensionSlotContributionSchema), {
    exact: true,
  }),
  customMessageRenderers: Schema.optionalWith(Schema.Array(extensionSlotContributionSchema), {
    exact: true,
  }),
  interactionRenderers: Schema.optionalWith(Schema.Array(extensionSlotContributionSchema), {
    exact: true,
  }),
  statusWidgets: Schema.optionalWith(Schema.Array(extensionSlotContributionSchema), {
    exact: true,
  }),
  sessionSummarySections: Schema.optionalWith(
    Schema.Array(extensionSessionSummaryContributionSchema),
    { exact: true },
  ),
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
