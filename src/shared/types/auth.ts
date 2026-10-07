// ─── OAuth Providers ────────────────────────────────────────────────

export type OAuthProvider = string

export function isOAuthProvider(value: string): value is OAuthProvider {
  return value.trim().length > 0
}

export interface OAuthDeviceCode {
  readonly userCode: string
  readonly verificationUri: string
  readonly intervalSeconds?: number
  readonly expiresInSeconds?: number
}

export interface OAuthSelectPrompt {
  readonly message: string
  readonly options: readonly {
    readonly id: string
    readonly label: string
  }[]
}

/** A text the provider's sign-in asks for, in the provider's own words. */
export interface OAuthInputPrompt {
  readonly message: string
  readonly placeholder?: string
  /** Mask the input, such as for a token. */
  readonly secret?: boolean
  /** A blank answer is a valid one, such as GitHub Copilot's "blank for github.com". */
  readonly allowEmpty?: boolean
}

/** What a sign-in that is waiting for the user shows: Pi's prompt and the link to open. */
export interface OAuthAwaitingInput {
  readonly prompt?: OAuthInputPrompt
  /** The sign-in link, to copy when the browser runs on another machine. */
  readonly authUrl?: string
  readonly instructions?: string
}

// ─── OAuth Flow Status ──────────────────────────────────────────────

export type OAuthFlowStatus =
  | { readonly type: 'idle' }
  | { readonly type: 'in-progress' }
  | ({ readonly type: 'awaiting-code'; readonly deviceCode?: OAuthDeviceCode } & OAuthAwaitingInput)
  | { readonly type: 'awaiting-selection'; readonly selection: OAuthSelectPrompt }
  | { readonly type: 'code-received' }
  | { readonly type: 'success' }
  | { readonly type: 'error'; readonly message: string }
  | { readonly type: 'in-progress'; readonly provider: OAuthProvider }
  | ({
      readonly type: 'awaiting-code'
      readonly provider: OAuthProvider
      readonly deviceCode?: OAuthDeviceCode
    } & OAuthAwaitingInput)
  | {
      readonly type: 'awaiting-selection'
      readonly provider: OAuthProvider
      readonly selection: OAuthSelectPrompt
    }
  | { readonly type: 'code-received'; readonly provider: OAuthProvider }
  | { readonly type: 'success'; readonly provider: OAuthProvider }
  | { readonly type: 'error'; readonly provider: OAuthProvider; readonly message: string }

// ─── Account Info ───────────────────────────────────────────────────

export interface OAuthAccountInfo {
  readonly provider: OAuthProvider
  readonly connected: boolean
  readonly label: string
}
