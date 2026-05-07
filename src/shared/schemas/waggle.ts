import { Schema } from '@shared/schema'
import {
  WAGGLE_AGENT_COLORS,
  WAGGLE_COLLABORATION_MODES,
  WAGGLE_STOP_CONDITIONS,
} from '@shared/types/waggle'

const MAX_ARG_1 = 100

export const waggleAgentColorSchema = Schema.Literal(...WAGGLE_AGENT_COLORS)

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
  model: Schema.String,
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
      Schema.greaterThanOrEqualTo(1),
      Schema.lessThanOrEqualTo(MAX_ARG_1),
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
