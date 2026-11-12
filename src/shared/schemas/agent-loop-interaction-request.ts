import { Schema } from '@shared/schema'
import { sessionIdSchema } from '@shared/types/brand'
import { authorizationScopeKeySchema, jsonValueSchema } from './validation'

/** The single source of the Agent loop interaction types in `@shared/types/agent-loop-interaction`. */
export const agentLoopInteractionKindSchema = Schema.Literal(
  'confirm',
  'select',
  'input',
  'editor',
  'notify',
  'custom',
)

export const agentLoopInteractionStatusSchema = Schema.Literal(
  'pending',
  'resolved',
  'cancelled',
  'errored',
)

export const agentLoopInteractionSourceSchema = Schema.Literal('pi-ui')

export const agentLoopNotifyLevelSchema = Schema.Literal('info', 'warning', 'error')

/**
 * Why a confirmation is being asked.
 *
 * Declared where the request is raised, never inferred from the wording, so a copy edit cannot
 * silently change what an access mode is allowed to answer.
 *
 * - `authorization`: the agent asks to act itself inside this workspace and session. The only
 *   purpose full access may answer.
 * - `user-input`: a question addressed to the user. Nothing may answer it for them.
 * - `disclosure`: exists to tell the user who is asking and for what, before they supply it.
 * - `external-navigation`: continues outside the application, at a destination the agent or a
 *   third party chose.
 */
export const agentLoopConfirmPurposeSchema = Schema.Literal(
  'authorization',
  'user-input',
  'disclosure',
  'external-navigation',
)

/** The fields every interaction carries, without its `kind`. */
export const agentLoopInteractionBaseFields = {
  interactionId: Schema.String,
  sessionId: sessionIdSchema,
  runId: Schema.String,
  source: agentLoopInteractionSourceSchema,
  createdAt: Schema.Number,
  timeoutMs: Schema.optionalWith(Schema.Number, { exact: true }),
}

export const agentLoopInteractionBaseSchema = Schema.Struct({
  ...agentLoopInteractionBaseFields,
  kind: agentLoopInteractionKindSchema,
})

export const agentLoopConfirmInteractionSchema = Schema.Struct({
  ...agentLoopInteractionBaseFields,
  kind: Schema.Literal('confirm'),
  title: Schema.String,
  message: Schema.String,
  purpose: agentLoopConfirmPurposeSchema,
  /** Present only for `authorization`, naming what a kept approval would cover. */
  scopeKey: Schema.optional(authorizationScopeKeySchema),
})

export const agentLoopSelectInteractionSchema = Schema.Struct({
  ...agentLoopInteractionBaseFields,
  kind: Schema.Literal('select'),
  title: Schema.String,
  choices: Schema.Array(Schema.String),
})

export const agentLoopInputInteractionSchema = Schema.Struct({
  ...agentLoopInteractionBaseFields,
  kind: Schema.Literal('input'),
  title: Schema.String,
  placeholder: Schema.optionalWith(Schema.String, { exact: true }),
})

export const agentLoopEditorInteractionSchema = Schema.Struct({
  ...agentLoopInteractionBaseFields,
  kind: Schema.Literal('editor'),
  title: Schema.String,
  prefill: Schema.optionalWith(Schema.String, { exact: true }),
})

export const agentLoopNotifyInteractionSchema = Schema.Struct({
  ...agentLoopInteractionBaseFields,
  kind: Schema.Literal('notify'),
  message: Schema.String,
  level: agentLoopNotifyLevelSchema,
})

export const agentLoopCustomInteractionRendererSchema = Schema.Struct({
  kind: Schema.Literal('pi-tui-custom'),
  supported: Schema.Literal(false),
  overlay: Schema.optionalWith(Schema.Boolean, { exact: true }),
})

export const agentLoopCustomInteractionSchema = Schema.Struct({
  ...agentLoopInteractionBaseFields,
  kind: Schema.Literal('custom'),
  customType: Schema.String,
  payload: Schema.optionalWith(jsonValueSchema, { exact: true }),
  renderer: agentLoopCustomInteractionRendererSchema,
})

export const agentLoopInteractionSchema = Schema.Union(
  agentLoopConfirmInteractionSchema,
  agentLoopSelectInteractionSchema,
  agentLoopInputInteractionSchema,
  agentLoopEditorInteractionSchema,
  agentLoopNotifyInteractionSchema,
  agentLoopCustomInteractionSchema,
)

export const agentLoopInteractionErrorCodeSchema = Schema.Literal(
  'interaction-not-found',
  'interaction-mismatch',
  'invalid-response-payload',
  'custom-renderer-unavailable',
  'interaction-timeout',
)

export const agentLoopInteractionSubmitResultSchema = Schema.Union(
  Schema.Struct({
    ok: Schema.Literal(true),
    interactionId: Schema.String,
    status: agentLoopInteractionStatusSchema,
  }),
  Schema.Struct({
    ok: Schema.Literal(false),
    error: Schema.Struct({ code: agentLoopInteractionErrorCodeSchema, message: Schema.String }),
  }),
)
