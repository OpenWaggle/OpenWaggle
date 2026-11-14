import { Schema } from '@shared/schema'
import { AGENT_AUTHORIZATION_DECISION_SCOPES } from '@shared/types/agent-authorization-grants'
import type { AgentLoopInteractionResponseInput } from '@shared/types/agent-loop-interaction'
import { SessionId } from '@shared/types/brand'
import { agentLoopInteractionKindSchema } from './agent-loop-interaction-request'
import {
  sessionInputIdSchema,
  sessionInputItemTextSchema,
  sessionInputJsonWithinLimit,
  sessionInputTextSchema,
} from './session-input'
import { jsonValueSchema } from './validation'

/**
 * `scope` must be declared here, not just on the TypeScript response type.
 *
 * Effect Schema decodes with `onExcessProperty: "ignore"`, which *removes* undeclared keys from the
 * decoded value rather than passing them through. An undeclared `scope` therefore never reached
 * `requestAuthorization`, so "Allow for this session" and "Always allow in this project" both
 * silently degraded to once-only and no grant was ever persisted. The union was then annotated with a
 * hand-written response type where `scope` was optional, so omitting it here still typechecked. The
 * response types are now inferred from these schemas; any future response field still needs a decode
 * test.
 */
export const confirmResponseSchema = Schema.Struct({
  kind: Schema.Literal('confirm'),
  accepted: Schema.Boolean,
  scope: Schema.optionalWith(Schema.Literal(...AGENT_AUTHORIZATION_DECISION_SCOPES), {
    exact: true,
  }),
})

export const selectResponseSchema = Schema.Struct({
  kind: Schema.Literal('select'),
  selected: Schema.NullOr(sessionInputItemTextSchema),
})

export const inputResponseSchema = Schema.Struct({
  kind: Schema.Literal('input'),
  value: Schema.NullOr(sessionInputTextSchema),
})

export const editorResponseSchema = Schema.Struct({
  kind: Schema.Literal('editor'),
  value: Schema.NullOr(sessionInputTextSchema),
})

export const notifyResponseSchema = Schema.Struct({
  kind: Schema.Literal('notify'),
  acknowledged: Schema.Literal(true),
})

export const customResponseSchema = Schema.Struct({
  kind: Schema.Literal('custom'),
  value: Schema.NullOr(jsonValueSchema.pipe(Schema.filter(sessionInputJsonWithinLimit))),
})

export const agentLoopResponseSchema = Schema.Union(
  confirmResponseSchema,
  selectResponseSchema,
  inputResponseSchema,
  editorResponseSchema,
  notifyResponseSchema,
  customResponseSchema,
)

/** The `agent:respond-interaction` input, with its Session id branded once it decodes. */
export const agentLoopResponseInputSchema = Schema.Struct({
  sessionId: sessionInputIdSchema.pipe(Schema.fromBrand(SessionId)),
  runId: sessionInputIdSchema,
  interactionId: sessionInputIdSchema,
  kind: agentLoopInteractionKindSchema,
  response: agentLoopResponseSchema,
})

/** The decoded input is already the service input; kept so the IPC handler's call still reads. */
export function toAgentLoopResponseInput(input: AgentLoopInteractionResponseInput) {
  return input
}
