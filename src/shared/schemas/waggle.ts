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
export const waggleModelBindingSchema = sessionInputIdSchema.pipe(
  Schema.filter(validateWaggleModelBinding),
)

export const waggleMetadataSchema = Schema.Struct({
  agentIndex: Schema.Number,
  agentLabel: sessionInputItemTextSchema,
  agentColor: waggleAgentColorSchema,
  agentModel: Schema.optional(sessionInputIdSchema),
  turnNumber: Schema.Number,
  sessionId: Schema.optional(sessionInputIdSchema),
})

export const waggleAgentSlotSchema = Schema.Struct({
  label: sessionInputItemTextSchema,
  model: waggleModelBindingSchema,
  roleDescription: sessionInputItemTextSchema,
  color: waggleAgentColorSchema,
})

export const waggleConfigSchema = Schema.Struct({
  mode: Schema.Literal(...WAGGLE_COLLABORATION_MODES),
  agents: Schema.Tuple(waggleAgentSlotSchema, waggleAgentSlotSchema),
  stop: Schema.Struct({
    primary: Schema.Literal(...WAGGLE_STOP_CONDITIONS),
    maxTurnsSafety: Schema.Number.pipe(
      Schema.int(),
      Schema.greaterThanOrEqualTo(MIN_WAGGLE_MAX_TURNS_SAFETY),
      Schema.lessThanOrEqualTo(MAX_WAGGLE_MAX_TURNS_SAFETY),
    ),
  }),
})

export const waggleInvocationMetadataSchema = Schema.Struct({
  presetId: sessionInputIdSchema,
  presetName: sessionInputItemTextSchema,
  source: Schema.Literal('user', 'agent'),
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
