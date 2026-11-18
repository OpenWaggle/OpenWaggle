import type { OAuthFlowStatus } from '@shared/types/auth'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { describe, expect, it, vi } from 'vitest'
import { ProviderOAuthService } from '../ports/provider-oauth-service'

const AUTH_URL = 'https://auth.test/oauth/authorize'

const flow = vi.hoisted(() => {
  const state: {
    readonly browserFinished: PromiseWithResolvers<void>
    readonly pastePrompt: AbortController
    pasted?: Promise<string>
  } = { browserFinished: Promise.withResolvers<void>(), pastePrompt: new AbortController() }
  return state
})

vi.mock('electron', () => ({
  shell: { openExternal: vi.fn().mockResolvedValue(undefined) },
}))

vi.mock('../logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn() }),
}))

vi.mock('../runtime', () => ({
  runAppEffect: (effect: Effect.Effect<unknown, unknown, ProviderOAuthService>) =>
    Effect.runPromise(
      Effect.provide(
        effect,
        Layer.succeed(
          ProviderOAuthService,
          ProviderOAuthService.of({
            listProviders: () => Effect.succeed(['openai-codex']),
            // A browser sign-in that also offers to paste the code; the browser callback wins.
            login: (_provider, handlers) =>
              Effect.promise(async () => {
                handlers.onAuthUrl(AUTH_URL, 'Open the link, or paste the code it shows.')
                flow.pasted = handlers.onManualCodeInput(
                  { message: 'Paste the authorization code' },
                  flow.pastePrompt.signal,
                )
                void flow.pasted.catch(() => undefined)
                await flow.browserFinished.promise
              }),
            logout: () => Effect.void,
            isConnected: () => Effect.succeed(false),
            getAccountInfo: (provider) =>
              Effect.succeed({
                provider,
                connected: false,
                label: 'Not connected',
              }),
          }),
        ),
      ),
    ),
}))
vi.mock('../gui-runtime', () => ({
  runGuiEffect: (effect: Effect.Effect<unknown, unknown, ProviderOAuthService>) =>
    Effect.runPromise(
      Effect.provide(
        effect,
        Layer.succeed(
          ProviderOAuthService,
          ProviderOAuthService.of({
            listProviders: () => Effect.succeed(['openai-codex']),
            // A browser sign-in that also offers to paste the code; the browser callback wins.
            login: (_provider, handlers) =>
              Effect.promise(async () => {
                handlers.onAuthUrl(AUTH_URL, 'Open the link, or paste the code it shows.')
                flow.pasted = handlers.onManualCodeInput(
                  { message: 'Paste the authorization code' },
                  flow.pastePrompt.signal,
                )
                void flow.pasted.catch(() => undefined)
                await flow.browserFinished.promise
              }),
            logout: () => Effect.void,
            isConnected: () => Effect.succeed(false),
            getAccountInfo: (provider) =>
              Effect.succeed({
                provider,
                connected: false,
                label: 'Not connected',
              }),
          }),
        ),
      ),
    ),
}))

describe('a sign-in whose browser callback wins over the paste field', () => {
  it('stops asking for a code and shows the sign-in as in progress', async () => {
    const { startOAuth, submitCode } = await import('../auth')
    const statuses: OAuthFlowStatus[] = []
    const signIn = startOAuth('openai-codex', (status) => statuses.push(status))
    await vi.waitFor(() => {
      expect(statuses.at(-1)).toMatchObject({ type: 'awaiting-code', prompt: expect.anything() })
    })

    flow.pastePrompt.abort()

    await vi.waitFor(() => {
      expect(statuses.at(-1)).toEqual({ type: 'in-progress', provider: 'openai-codex' })
    })
    await expect(flow.pasted).rejects.toThrow()
    // A code pasted after the callback goes nowhere.
    submitCode('openai-codex', 'late-code')
    flow.browserFinished.resolve()
    await signIn
    expect(statuses.at(-1)).toEqual({ type: 'success', provider: 'openai-codex' })
  })
})
