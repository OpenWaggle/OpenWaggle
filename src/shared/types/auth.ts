import { includes } from '@shared/utils/validation'
import { z } from 'zod'

// ─── Subscription Providers ─────────────────────────────────────────

export const SUBSCRIPTION_PROVIDERS = ['openrouter', 'openai', 'anthropic'] as const
export type SubscriptionProvider = (typeof SUBSCRIPTION_PROVIDERS)[number]

export function isSubscriptionProvider(value: string): value is SubscriptionProvider {
  return includes(SUBSCRIPTION_PROVIDERS, value)
}

// ─── Auth Method ────────────────────────────────────────────────────

export const AUTH_METHODS = ['api-key', 'subscription'] as const
export type AuthMethod = (typeof AUTH_METHODS)[number]

// ─── OAuth Flow Status ──────────────────────────────────────────────

export type OAuthFlowStatus =
  | { readonly type: 'idle' }
  | { readonly type: 'in-progress'; readonly provider: SubscriptionProvider }
  | { readonly type: 'awaiting-code'; readonly provider: SubscriptionProvider }
  | { readonly type: 'code-received'; readonly provider: SubscriptionProvider }
  | { readonly type: 'success'; readonly provider: SubscriptionProvider }
  | { readonly type: 'error'; readonly provider: SubscriptionProvider; readonly message: string }

// ─── Account Info ───────────────────────────────────────────────────

export interface SubscriptionAccountInfo {
  readonly provider: SubscriptionProvider
  readonly connected: boolean
  readonly label: string
  readonly disconnectedReason?: string
}

// ─── Zod Schemas (IPC boundary validation) ──────────────────────────

export const subscriptionProviderSchema = z.enum(SUBSCRIPTION_PROVIDERS)

export const oauthFlowStatusSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('idle') }),
  z.object({ type: z.literal('in-progress'), provider: subscriptionProviderSchema }),
  z.object({ type: z.literal('awaiting-code'), provider: subscriptionProviderSchema }),
  z.object({ type: z.literal('code-received'), provider: subscriptionProviderSchema }),
  z.object({ type: z.literal('success'), provider: subscriptionProviderSchema }),
  z.object({
    type: z.literal('error'),
    provider: subscriptionProviderSchema,
    message: z.string(),
  }),
])

export const subscriptionAccountInfoSchema = z.object({
  provider: subscriptionProviderSchema,
  connected: z.boolean(),
  label: z.string(),
  disconnectedReason: z.string().optional(),
})
