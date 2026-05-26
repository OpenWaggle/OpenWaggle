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
import { Schema } from '@shared/schema'

function validateWaggleModelBinding(value: string) {
  return isWaggleInheritedModel(value) || isProviderQualifiedWaggleModel(value)
    ? true
    : `model must be ${WAGGLE_INHERIT_MODEL} or a provider/model id.`
}

export const waggleAgentColorSchema = Schema.Literal(...WAGGLE_AGENT_COLORS)
export const waggleModelBindingSchema = Schema.String.pipe(
  Schema.filter(validateWaggleModelBinding),
)

export const waggleMetadataSchema = Schema.Struct({
  agentIndex: Schema.Number,
  agentLabel: Schema.String,
  agentColor: waggleAgentColorSchema,
  agentModel: Schema.optional(Schema.String),
  turnNumber: Schema.Number,
  sessionId: Schema.optional(Schema.String),
})

export const waggleAgentSlotSchema = Schema.Struct({
  label: Schema.String,
  model: waggleModelBindingSchema,
  roleDescription: Schema.String,
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

export const wagglePresetSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  description: Schema.String,
  config: waggleConfigSchema,
  isBuiltIn: Schema.Boolean,
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
})
