import { MAX_NODE_TIMER_DELAY_MS } from '@shared/constants/time'
import { decodeUnknownExactOrThrow, parseJsonUnknown, Schema } from '@shared/schema'
import { inlineVisualizationContextSchema } from '@shared/schemas/validation'
import { toWaggleInvocation, waggleInvocationSchema } from '@shared/schemas/waggle'
import { AGENT_AUTHORIZATION_MODES } from '@shared/types/agent-authorization'
import { THINKING_LEVELS } from '@shared/types/settings'
import type {
  SessionControlIntentSnapshot,
  SessionControlRunIntent,
} from '../domain/session-control/message-aggregate'

const followUpIntentFields = {
  text: Schema.String,
  attachmentIds: Schema.Array(Schema.String),
  waggle: Schema.optionalWith(waggleInvocationSchema, { exact: true }),
  visualizationContext: Schema.optionalWith(inlineVisualizationContextSchema, { exact: true }),
  interactionTimeoutMs: Schema.optionalWith(
    Schema.Number.pipe(Schema.int(), Schema.between(0, MAX_NODE_TIMER_DELAY_MS)),
    { exact: true },
  ),
  callerId: Schema.String,
  acceptedAt: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
  idempotencyKey: Schema.String,
  returnedSteer: Schema.optionalWith(Schema.Struct({ runId: Schema.String }), { exact: true }),
}

/**
 * A starting Run's intent: its Follow-up intent snapshot plus what only a Run started on an idle
 * Session has: its settings (`thinkingLevel`, `runAuthorizationOverride`) and the Host's `hiveWake`.
 * A stored Follow-up decodes with the same schema; `decodeFollowUpIntent` drops those three.
 * `authorCallerId` is kept: who queued a Follow-up the desktop user adopted (`queue-adopt`).
 */
const storedIntentSchema = Schema.Struct({
  ...followUpIntentFields,
  thinkingLevel: Schema.optionalWith(Schema.Literal(...THINKING_LEVELS), { exact: true }),
  runAuthorizationOverride: Schema.optionalWith(Schema.Literal(...AGENT_AUTHORIZATION_MODES), {
    exact: true,
  }),
  authorCallerId: Schema.optionalWith(Schema.String, { exact: true }),
  hiveWake: Schema.optionalWith(Schema.Literal(true), { exact: true }),
})

export function decodeRunIntent(raw: string): SessionControlRunIntent {
  const { waggle, ...intent } = decodeUnknownExactOrThrow(storedIntentSchema, parseJsonUnknown(raw))
  return {
    ...intent,
    ...(waggle ? { waggle: toWaggleInvocation(waggle) } : {}),
  }
}

export function decodeFollowUpIntent(raw: string): SessionControlIntentSnapshot {
  const {
    thinkingLevel: _thinkingLevel,
    runAuthorizationOverride: _runAuthorizationOverride,
    hiveWake: _hiveWake,
    ...intent
  } = decodeRunIntent(raw)
  return intent
}
