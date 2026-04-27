// ─── OAuth Providers ────────────────────────────────────────────────

export type OAuthProvider = string

export function isOAuthProvider(value: string): value is OAuthProvider {
  return value.trim().length > 0
}

// ─── OAuth Flow Status ──────────────────────────────────────────────

export type OAuthFlowStatus =
  | { readonly type: 'idle' }
  | { readonly type: 'in-progress' }
  | { readonly type: 'awaiting-code' }
  | { readonly type: 'code-received' }
  | { readonly type: 'success' }
  | { readonly type: 'error'; readonly message: string }
  | { readonly type: 'in-progress'; readonly provider: OAuthProvider }
  | { readonly type: 'awaiting-code'; readonly provider: OAuthProvider }
  | { readonly type: 'code-received'; readonly provider: OAuthProvider }
  | { readonly type: 'success'; readonly provider: OAuthProvider }
  | { readonly type: 'error'; readonly provider: OAuthProvider; readonly message: string }

// ─── Account Info ───────────────────────────────────────────────────

export interface OAuthAccountInfo {
  readonly provider: OAuthProvider
  readonly connected: boolean
  readonly label: string
}
