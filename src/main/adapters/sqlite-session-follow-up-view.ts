import { parseSessionJson } from './sqlite-session-query-support'

/** A Follow-up attention reason as a stored row may still hold it. */
export type StoredFollowUpAttentionReason =
  | 'authorization_ceiling_changed'
  | 'profile_revoked'
  | 'authority_changed'

/** The retired Follow-up authorization block: a Follow-up no longer carries an override. */
const RETIRED_ATTENTION_REASON = 'authorization_ceiling_changed'

/** Fields a stored Follow-up intent may carry from before a Follow-up stopped carrying them. */
const RETIRED_INTENT_FIELDS = new Set([
  'thinkingLevel',
  'runAuthorizationOverride',
  'authorCallerId',
])

/**
 * How a stored Follow-up's delivery reads: one blocked only on its retired authorization override
 * is pending, the same as when Session Control loads it.
 */
export function followUpDeliveryView(row: {
  readonly delivery_state: 'pending' | 'needs_attention'
  readonly attention_reason: StoredFollowUpAttentionReason | null
}):
  | { readonly deliveryState: 'pending' }
  | {
      readonly deliveryState: 'needs_attention'
      readonly attentionReason: 'profile_revoked' | 'authority_changed'
    } {
  if (
    row.delivery_state === 'pending' ||
    row.attention_reason === null ||
    row.attention_reason === RETIRED_ATTENTION_REASON
  ) {
    return { deliveryState: 'pending' }
  }
  return { deliveryState: 'needs_attention', attentionReason: row.attention_reason }
}

/** A stored Follow-up intent body without the fields a Follow-up no longer carries. */
export function followUpIntentView(intentJson: string): unknown {
  const intent = parseSessionJson(intentJson)
  if (typeof intent !== 'object' || intent === null || Array.isArray(intent)) return intent
  return Object.fromEntries(
    Object.entries(intent).filter(([key]) => !RETIRED_INTENT_FIELDS.has(key)),
  )
}
