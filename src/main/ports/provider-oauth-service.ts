import type { OAuthAccountInfo, OAuthProvider } from '@shared/types/auth'
import { Context, type Effect } from 'effect'

export interface OAuthLoginHandlers {
  readonly onAuthUrl: (url: string, usesCallbackServer: boolean) => void
  readonly onPrompt: () => Promise<string>
  readonly onProgress: () => void
  readonly onManualCodeInput: () => Promise<string>
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
