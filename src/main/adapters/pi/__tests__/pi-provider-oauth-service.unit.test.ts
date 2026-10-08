import type { AuthInteraction } from '@earendil-works/pi-ai'
import * as Effect from 'effect/Effect'
import { describe, expect, it, vi } from 'vitest'
import {
  type OAuthLoginHandlers,
  ProviderOAuthService,
} from '../../../ports/provider-oauth-service'

const runtime = vi.hoisted(() => ({
  login: async (_provider: string, _type: string, _interaction: AuthInteraction) => {},
}))

vi.mock('@earendil-works/pi-coding-agent', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@earendil-works/pi-coding-agent')>()),
  ModelRuntime: {
    create: async () => ({
      getProvider: () => ({ auth: { oauth: {} } }),
      login: (provider: string, type: string, interaction: AuthInteraction) =>
        runtime.login(provider, type, interaction),
    }),
  },
}))

const { PiProviderOAuthLive } = await import('../pi-provider-oauth-service')

function handlers(overrides: Partial<OAuthLoginHandlers> = {}): OAuthLoginHandlers {
  return {
    onAuthUrl: vi.fn(),
    onDeviceCode: vi.fn(),
    onSelect: vi.fn(async () => undefined),
    onPrompt: vi.fn(async () => 'typed'),
    onProgress: vi.fn(),
    onManualCodeInput: vi.fn(async () => 'pasted-code'),
    signal: new AbortController().signal,
    ...overrides,
  }
}

function login(provider: string, loginHandlers: OAuthLoginHandlers) {
  return Effect.runPromise(
    Effect.gen(function* () {
      const service = yield* ProviderOAuthService
      yield* service.login(provider, loginHandlers)
    }).pipe(Effect.provide(PiProviderOAuthLive)),
  )
}

describe('Pi provider sign-in', () => {
  it("keeps a copy-code login's link, instructions and prompt text for the sign-in UI", async () => {
    const answers: string[] = []
    runtime.login = async (_provider, _type, interaction) => {
      interaction.notify({
        type: 'auth_url',
        url: 'https://claude.ai/oauth/authorize?code=true',
        instructions: 'Open the link in any browser, then paste the code it shows.',
      })
      answers.push(
        await interaction.prompt({
          type: 'manual_code',
          message: 'Paste the authorization code',
          placeholder: 'code#state',
        }),
      )
    }
    const loginHandlers = handlers()

    await login('anthropic', loginHandlers)

    expect(loginHandlers.onAuthUrl).toHaveBeenCalledWith(
      'https://claude.ai/oauth/authorize?code=true',
      'Open the link in any browser, then paste the code it shows.',
    )
    expect(loginHandlers.onManualCodeInput).toHaveBeenCalledWith({
      message: 'Paste the authorization code',
      placeholder: 'code#state',
    })
    expect(answers).toEqual(['pasted-code'])
  })

  it('asks for text and secrets with their own wording, masking secrets and allowing blank text', async () => {
    runtime.login = async (_provider, _type, interaction) => {
      await interaction.prompt({ type: 'text', message: 'Radius workspace URL' })
      await interaction.prompt({ type: 'secret', message: 'Paste your token' })
    }
    const loginHandlers = handlers()

    await login('radius', loginHandlers)

    expect(loginHandlers.onPrompt).toHaveBeenNthCalledWith(1, {
      message: 'Radius workspace URL',
      secret: false,
      allowEmpty: true,
    })
    expect(loginHandlers.onPrompt).toHaveBeenNthCalledWith(2, {
      message: 'Paste your token',
      secret: true,
    })
  })
})
