import { includes } from '@shared/utils/validation'

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
