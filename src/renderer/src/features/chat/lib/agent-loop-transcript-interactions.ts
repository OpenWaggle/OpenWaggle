import { OPENWAGGLE_AGENT_LOOP } from '@shared/constants/agent-loop'
import { Schema } from '@shared/schema'
import {
  agentLoopConfirmInteractionSchema,
  agentLoopConfirmPurposeSchema,
  agentLoopCustomInteractionRendererSchema,
  agentLoopCustomInteractionSchema,
  agentLoopEditorInteractionSchema,
  agentLoopInputInteractionSchema,
  agentLoopInteractionBaseFields,
  agentLoopNotifyInteractionSchema,
  agentLoopSelectInteractionSchema,
} from '@shared/schemas/agent-loop-interaction-request'
import { lenientExactOptional, lenientWithFallback } from '@shared/schemas/lenient-exact'
import { authorizationScopeKeySchema, jsonValueSchema } from '@shared/schemas/validation'
import type {
  AgentLoopConfirmPurpose,
  AgentLoopCustomInteraction,
  AgentLoopInteraction,
} from '@shared/types/agent-loop-interaction'
import { Option } from 'effect'

/**
 * How the renderer reads an Agent loop interaction back from persisted history: the strict
 * interaction schemas, with the deliberate tolerance a replay needs. The decoded type is the strict
 * `AgentLoopInteraction`.
 */

/** Every interaction needs its identity; a malformed `timeoutMs` is left out. */
const persistedBaseFields = {
  ...agentLoopInteractionBaseFields,
  timeoutMs: lenientExactOptional(Schema.Number),
}

/**
 * Rehydrates the grant key from persisted history.
 *
 * Without this a request replayed after a reload kept its `authorization` purpose but lost its key,
 * so it no longer counted as an authorization request: the ribbon degraded to a plain question with
 * no scope choices, and the user could not keep an approval they had been offered before.
 *
 * The capability is validated rather than trusted. An unknown capability from a newer build yields
 * no key, which degrades to a prompt with no scope choices instead of inventing a key that would
 * match the wrong thing. A malformed `resource` alone is left out.
 */
const persistedScopeKeySchema = Schema.Struct({
  ...authorizationScopeKeySchema.fields,
  resource: lenientExactOptional(Schema.String),
})

const persistedConfirmInteractionSchema = Schema.Struct({
  ...agentLoopConfirmInteractionSchema.fields,
  ...persistedBaseFields,
  /**
   * An unrecognised or missing purpose becomes `user-input`, the purpose nothing may answer on the
   * user's behalf. Replayed history must never widen into `authorization`.
   */
  purpose: lenientWithFallback(
    agentLoopConfirmPurposeSchema,
    (): AgentLoopConfirmPurpose => 'user-input',
  ),
  scopeKey: lenientExactOptional(persistedScopeKeySchema),
})

const persistedSelectInteractionSchema = Schema.Struct({
  ...agentLoopSelectInteractionSchema.fields,
  ...persistedBaseFields,
})

const persistedInputInteractionSchema = Schema.Struct({
  ...agentLoopInputInteractionSchema.fields,
  ...persistedBaseFields,
  placeholder: lenientExactOptional(Schema.String),
})

const persistedEditorInteractionSchema = Schema.Struct({
  ...agentLoopEditorInteractionSchema.fields,
  ...persistedBaseFields,
  prefill: lenientExactOptional(Schema.String),
})

const persistedNotifyInteractionSchema = Schema.Struct({
  ...agentLoopNotifyInteractionSchema.fields,
  ...persistedBaseFields,
})

const decodeRendererOverlay = Schema.decodeUnknownOption(
  Schema.Struct({ overlay: lenientExactOptional(Schema.Boolean) }),
)

/** A replayed custom interaction is never rendered: only whether it was an overlay is kept. */
const persistedCustomRendererField = Schema.optionalToRequired(
  Schema.Unknown,
  Schema.typeSchema(agentLoopCustomInteractionRendererSchema),
  {
    decode: (value) => {
      const renderer: AgentLoopCustomInteraction['renderer'] = {
        kind: 'pi-tui-custom',
        supported: false,
        ...Option.getOrElse(Option.flatMap(value, decodeRendererOverlay), () => ({})),
      }
      return renderer
    },
    encode: (value) => Option.some(value),
  },
)

const persistedCustomInteractionSchema = Schema.Struct({
  ...agentLoopCustomInteractionSchema.fields,
  ...persistedBaseFields,
  customType: lenientWithFallback(
    Schema.String,
    () => OPENWAGGLE_AGENT_LOOP.PI_TUI_CUSTOM_INTERACTION_TYPE,
  ),
  payload: lenientExactOptional(jsonValueSchema),
  renderer: persistedCustomRendererField,
})

export const persistedAgentLoopInteractionSchema = Schema.Union(
  persistedConfirmInteractionSchema,
  persistedSelectInteractionSchema,
  persistedInputInteractionSchema,
  persistedEditorInteractionSchema,
  persistedNotifyInteractionSchema,
  persistedCustomInteractionSchema,
)

const decodeInteraction = Schema.decodeUnknownOption(persistedAgentLoopInteractionSchema)

/** The interaction a persisted request holds, or null when it is not one this build can show. */
export function parseInteraction(interaction: unknown): AgentLoopInteraction | null {
  return Option.getOrNull(decodeInteraction(interaction))
}
