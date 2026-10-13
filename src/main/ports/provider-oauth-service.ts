import type {
  OAuthAccountInfo,
  OAuthDeviceCode,
  OAuthInputPrompt,
  OAuthProvider,
  OAuthSelectPrompt,
} from '@shared/types/auth'
import { Context, type Effect } from 'effect'

export interface OAuthLoginHandlers {
  /** `instructions` is the provider's own text, such as how to finish a copy-code sign-in. */
  /** The sign-in link to open, and what the provider says to do with it. */
  readonly onAuthUrl: (url: string, instructions?: string) => void
  readonly onDeviceCode: (params: OAuthDeviceCode) => void
  readonly onSelect: (params: OAuthSelectPrompt) => Promise<string | undefined>
  /** `signal` aborts when the sign-in no longer needs the answer, such as a browser callback. */
  readonly onPrompt: (prompt: OAuthInputPrompt, signal?: AbortSignal) => Promise<string>
  readonly onProgress: () => void
  readonly onManualCodeInput: (
    prompt: Omit<OAuthInputPrompt, 'secret'>,
    signal?: AbortSignal,
  ) => Promise<string>
  readonly signal: AbortSignal
}

export interface ProviderOAuthServiceShape {
  readonly listProviders: () => Effect.Effect<readonly OAuthProvider[], Error>
  readonly login: (
    provider: OAuthProvider,
    handlers: OAuthLoginHandlers,
  ) => Effect.Effect<void, Error>
  readonly logout: (provider: OAuthProvider) => Effect.Effect<void, Error>
  readonly isConnected: (provider: OAuthProvider) => Effect.Effect<boolean, Error>
  readonly getAccountInfo: (provider: OAuthProvider) => Effect.Effect<OAuthAccountInfo, Error>
}

export class ProviderOAuthService extends Context.Tag('@openwaggle/ProviderOAuthService')<
  ProviderOAuthService,
  ProviderOAuthServiceShape
>() {}
