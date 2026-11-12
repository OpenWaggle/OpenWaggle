import {
  isProviderQualifiedWaggleModel,
  isWaggleInheritedModel,
  MAX_WAGGLE_MAX_TURNS_SAFETY,
  MIN_WAGGLE_MAX_TURNS_SAFETY,
  WAGGLE_AGENT_COLORS,
  WAGGLE_COLLABORATION_MODES,
  WAGGLE_INHERIT_MODEL,
  WAGGLE_STOP_CONDITIONS,
} from '@openwaggle/waggle-core'
import { Schema, type SchemaType } from '@shared/schema'
import { SupportedModelId, supportedModelIdSchema, wagglePresetIdSchema } from '@shared/types/brand'
import {
  createWaggleModelBinding,
  type WaggleConfig,
  type WaggleHandoffRequest,
  type WaggleInvocation,
} from '@shared/types/waggle'
import {
  sessionInputIdSchema,
  sessionInputItemTextSchema,
  sessionInputTextSchema,
} from './session-input'

function validateWaggleModelBinding(value: string) {
  return isWaggleInheritedModel(value) || isProviderQualifiedWaggleModel(value)
    ? true
    : `model must be ${WAGGLE_INHERIT_MODEL} or a provider/model id.`
}

export const waggleAgentColorSchema = Schema.Literal(...WAGGLE_AGENT_COLORS)
export const waggleCollaborationModeSchema = Schema.Literal(...WAGGLE_COLLABORATION_MODES)
export const waggleStopConditionSchema = Schema.Literal(...WAGGLE_STOP_CONDITIONS)

/**
 * A slot's model as the wire carries it: the inherited model or a provider-qualified model id. It
 * decodes to a plain string because the Session control and Session Host protocol schemas are still
 * annotated with their wire types; `toWaggleConfig` brands it at the main-process boundary.
 */ export const waggleModelBindingSchema = sessionInputIdSchema.pipe(
  Schema.filter(validateWaggleModelBinding),
)

/** A persisted Waggle message's turn metadata: the single source of `WaggleMessageMetadata`. */
export const waggleMetadataSchema = Schema.Struct({
  agentIndex: Schema.Number,
  agentLabel: sessionInputItemTextSchema,
  agentColor: waggleAgentColorSchema,
  agentModel: Schema.optionalWith(sessionInputIdSchema.pipe(Schema.fromBrand(SupportedModelId)), {
    exact: true,
  }),
  turnNumber: Schema.Number,
  /** Unique ID for this waggle session. Groups turns that belong to the same waggle run. */
  sessionId: Schema.optionalWith(sessionInputIdSchema, { exact: true }),
})

export const waggleAgentSlotSchema = Schema.Struct({
  label: sessionInputItemTextSchema,
  model: waggleModelBindingSchema,
  roleDescription: sessionInputItemTextSchema,
  color: waggleAgentColorSchema,
})

export const waggleStopConfigSchema = Schema.Struct({
  primary: waggleStopConditionSchema,
  maxTurnsSafety: Schema.Number.pipe(
    Schema.int(),
    Schema.greaterThanOrEqualTo(MIN_WAGGLE_MAX_TURNS_SAFETY),
    Schema.lessThanOrEqualTo(MAX_WAGGLE_MAX_TURNS_SAFETY),
  ),
})

export const waggleConfigSchema = Schema.Struct({
  mode: waggleCollaborationModeSchema,
  agents: Schema.Tuple(waggleAgentSlotSchema, waggleAgentSlotSchema),
  stop: waggleStopConfigSchema,
})

export const waggleInvocationSourceSchema = Schema.Literal('user', 'agent')

export const waggleInvocationMetadataSchema = Schema.Struct({
  presetId: sessionInputIdSchema,
  presetName: sessionInputItemTextSchema,
  source: waggleInvocationSourceSchema,
})

export const waggleInvocationSchema = Schema.Struct({
  ...waggleInvocationMetadataSchema.fields,
  config: waggleConfigSchema,
})

export const waggleHandoffRequestSchema = Schema.Struct({
  kind: Schema.Literal('waggle-handoff'),
  ...waggleInvocationSchema.fields,
  prompt: sessionInputTextSchema,
})

/*
 * The domain forms the main process and renderer use once a model binding is branded. Each is the
 * wire schema above with the binding (and a preset's id) branded; `toWaggleConfig` and its
 * siblings make one from the other.
 */
const brandedWaggleModelBindingSchema = Schema.Union(
  Schema.Literal(WAGGLE_INHERIT_MODEL),
  supportedModelIdSchema,
)

export const waggleAgentSlotDomainSchema = Schema.Struct({
  ...waggleAgentSlotSchema.fields,
  model: brandedWaggleModelBindingSchema,
})

export const waggleConfigDomainSchema = Schema.Struct({
  ...waggleConfigSchema.fields,
  agents: Schema.Tuple(waggleAgentSlotDomainSchema, waggleAgentSlotDomainSchema),
})

export const waggleInvocationDomainSchema = Schema.Struct({
  ...waggleInvocationMetadataSchema.fields,
  config: waggleConfigDomainSchema,
})

export const waggleHandoffRequestDomainSchema = Schema.Struct({
  ...waggleHandoffRequestSchema.fields,
  config: waggleConfigDomainSchema,
})

export function toWaggleConfig(input: SchemaType<typeof waggleConfigSchema>): WaggleConfig {
  return {
    ...input,
    agents: [
      { ...input.agents[0], model: createWaggleModelBinding(input.agents[0].model) },
      { ...input.agents[1], model: createWaggleModelBinding(input.agents[1].model) },
    ],
  }
}

export function toWaggleInvocation(
  input: SchemaType<typeof waggleInvocationSchema>,
): WaggleInvocation {
  return { ...input, config: toWaggleConfig(input.config) }
}

export function toWaggleHandoffRequest(
  input: SchemaType<typeof waggleHandoffRequestSchema>,
): WaggleHandoffRequest {
  return { ...input, config: toWaggleConfig(input.config) }
}

export const wagglePresetSchema = Schema.Struct({
  id: sessionInputIdSchema,
  name: sessionInputItemTextSchema,
  description: sessionInputTextSchema,
  config: waggleConfigSchema,
  isBuiltIn: Schema.Boolean,
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
})

export const wagglePresetDomainSchema = Schema.Struct({
  ...wagglePresetSchema.fields,
  id: wagglePresetIdSchema,
  config: waggleConfigDomainSchema,
})
