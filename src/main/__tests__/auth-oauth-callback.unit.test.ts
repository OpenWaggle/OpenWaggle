import type { OAuthFlowStatus } from '@shared/types/auth'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { describe, expect, it, vi } from 'vitest'
import { ProviderOAuthService } from '../ports/provider-oauth-service'

const RADIUS_AUTH_URL = 'https://radius.test/oauth/authorize'

const browserFinished = vi.hoisted(() => Promise.withResolvers<void>())

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
            listProviders: () => Effect.succeed(['radius']),
            // Radius's sign-in: a link and what to do with it, then the browser finishes it.
            login: (_provider, handlers) =>
              Effect.promise(async () => {
                handlers.onAuthUrl(RADIUS_AUTH_URL, 'Continue in your browser.')
                await browserFinished.promise
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

describe('a sign-in that finishes in the browser', () => {
  it('shows its instructions and sign-in link while it waits', async () => {
    const { startOAuth } = await import('../auth')
    const statuses: OAuthFlowStatus[] = []
    const flow = startOAuth('radius', (status) => statuses.push(status))

    await vi.waitFor(() => {
      expect(statuses).toContainEqual({
        type: 'awaiting-code',
        provider: 'radius',
        authUrl: RADIUS_AUTH_URL,
        instructions: 'Continue in your browser.',
      })
    })
    browserFinished.resolve()
    await flow
  })
})
