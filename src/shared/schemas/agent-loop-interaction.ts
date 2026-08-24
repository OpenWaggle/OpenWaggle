import { Schema } from '@shared/schema'
import { AGENT_AUTHORIZATION_DECISION_SCOPES } from '@shared/types/agent-authorization-grants'
import type {
  AgentLoopInteractionKind,
  AgentLoopInteractionResponse,
  AgentLoopInteractionResponseInput,
} from '@shared/types/agent-loop-interaction'
import { SessionId } from '@shared/types/brand'
import { jsonValueSchema } from './validation'

const interactionKindSchema = Schema.Literal(
  'confirm',
  'select',
  'input',
  'editor',
  'notify',
  'custom',
)

/**
 * `scope` must be declared here, not just on the TypeScript response type.
 *
 * Effect Schema decodes with `onExcessProperty: "ignore"`, which *removes* undeclared keys from the
 * decoded value rather than passing them through. An undeclared `scope` therefore never reached
 * `requestAuthorization`, so "Allow for this session" and "Always allow in this project" both
 * silently degraded to once-only and no grant was ever persisted. The union is annotated
 * `Schema.Schema<AgentLoopInteractionResponse>` and `scope` is optional, so omitting it here still
 * typechecked. Any future response field needs the same treatment plus a decode test.
 */
const confirmResponseSchema = Schema.Struct({
  kind: Schema.Literal('confirm'),
  accepted: Schema.Boolean,
  scope: Schema.optional(Schema.Literal(...AGENT_AUTHORIZATION_DECISION_SCOPES)),
})

const selectResponseSchema = Schema.Struct({
  kind: Schema.Literal('select'),
  selected: Schema.NullOr(Schema.String),
})

const inputResponseSchema = Schema.Struct({
  kind: Schema.Literal('input'),
  value: Schema.NullOr(Schema.String),
})

const editorResponseSchema = Schema.Struct({
  kind: Schema.Literal('editor'),
  value: Schema.NullOr(Schema.String),
})

const notifyResponseSchema = Schema.Struct({
  kind: Schema.Literal('notify'),
  acknowledged: Schema.Literal(true),
})

const customResponseSchema = Schema.Struct({
  kind: Schema.Literal('custom'),
  value: Schema.NullOr(jsonValueSchema),
})

export const agentLoopResponseSchema: Schema.Schema<AgentLoopInteractionResponse> = Schema.Union(
  confirmResponseSchema,
  selectResponseSchema,
  inputResponseSchema,
  editorResponseSchema,
  notifyResponseSchema,
  customResponseSchema,
)

interface DecodedAgentLoopInteractionResponseInput {
  readonly sessionId: string
  readonly runId: string
  readonly interactionId: string
  readonly kind: AgentLoopInteractionKind
  readonly response: AgentLoopInteractionResponse
}

export const agentLoopResponseInputSchema: Schema.Schema<DecodedAgentLoopInteractionResponseInput> =
  Schema.Struct({
    sessionId: Schema.String,
    runId: Schema.String,
    interactionId: Schema.String,
    kind: interactionKindSchema,
    response: agentLoopResponseSchema,
  })

export function toAgentLoopResponseInput(
  input: DecodedAgentLoopInteractionResponseInput,
): AgentLoopInteractionResponseInput {
  return {
    sessionId: SessionId(input.sessionId),
    runId: input.runId,
    interactionId: input.interactionId,
    kind: input.kind,
    response: input.response,
  }
}
