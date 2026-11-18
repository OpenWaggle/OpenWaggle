import { Schema } from '@shared/schema'
import { sessionIdSchema, supportedModelIdSchema } from '@shared/types/brand'
import {
  waggleAgentColorSchema,
  waggleCollaborationModeSchema,
  waggleInvocationDomainSchema,
} from './waggle'

/** The single source of the Waggle run event types in `@shared/types/waggle`. */

export const waggleFileConflictWarningSchema = Schema.Struct({
  path: Schema.String,
  previousAgent: Schema.String,
  currentAgent: Schema.String,
  turnNumber: Schema.Number,
})

export const waggleConsensusSignalSchema = Schema.Struct({
  type: Schema.Literal(
    'explicit-agreement',
    'no-new-information',
    'action-convergence',
    'turn-limit',
  ),
  confidence: Schema.Number,
  reason: Schema.String,
})

export const waggleConsensusCheckResultSchema = Schema.Struct({
  reached: Schema.Boolean,
  confidence: Schema.Number,
  reason: Schema.String,
  signals: Schema.Array(waggleConsensusSignalSchema),
})

/** The turn a `session-waggle-transport` event's transport event belongs to. */
export const waggleStreamMetadataSchema = Schema.Struct({
  agentIndex: Schema.Number,
  agentLabel: Schema.String,
  agentColor: waggleAgentColorSchema,
  agentModel: supportedModelIdSchema,
  turnNumber: Schema.Number,
  collaborationMode: waggleCollaborationModeSchema,
  sessionId: Schema.optionalWith(Schema.String, { exact: true }),
})

const turnFields = {
  turnNumber: Schema.Number,
  agentIndex: Schema.Number,
  agentLabel: Schema.String,
}

export const waggleTurnEventSchema = Schema.Union(
  Schema.Struct({
    type: Schema.Literal('collaboration-pending'),
    sessionId: sessionIdSchema,
    invocation: waggleInvocationDomainSchema,
  }),
  Schema.Struct({ type: Schema.Literal('turn-start'), ...turnFields }),
  Schema.Struct({
    type: Schema.Literal('turn-end'),
    ...turnFields,
    agentColor: waggleAgentColorSchema,
    agentModel: supportedModelIdSchema,
  }),
  Schema.Struct({
    type: Schema.Literal('consensus-reached'),
    result: waggleConsensusCheckResultSchema,
  }),
  Schema.Struct({
    type: Schema.Literal('file-conflict'),
    warning: waggleFileConflictWarningSchema,
  }),
  Schema.Struct({
    type: Schema.Literal('collaboration-complete'),
    reason: Schema.String,
    totalTurns: Schema.Number,
  }),
  Schema.Struct({ type: Schema.Literal('collaboration-stopped'), reason: Schema.String }),
)
