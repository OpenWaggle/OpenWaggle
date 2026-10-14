import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { AuthInteraction, LoginOptions } from '@earendil-works/pi-ai'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  type OAuthLoginHandlers,
  ProviderOAuthService,
} from '../../../ports/provider-oauth-service'

const runtime = vi.hoisted(() => ({
  login: async (
    _provider: string,
    _type: string,
    _interaction: AuthInteraction,
    _options?: LoginOptions,
  ) => {},
}))

vi.mock('@earendil-works/pi-coding-agent', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@earendil-works/pi-coding-agent')>()),
  ModelRuntime: {
    create: async () => ({
      getProvider: () => ({ auth: { oauth: {} } }),
      login: (
        provider: string,
        type: string,
        interaction: AuthInteraction,
        options?: LoginOptions,
      ) => runtime.login(provider, type, interaction, options),
    }),
  },
}))

const { PiProviderOAuthLive } = await import('../pi-provider-oauth-service')

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
let home = ''
let agentDirectory = ''

beforeEach(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-pi-oauth-home-'))
  agentDirectory = path.join(home, '.pi', 'agent')
  vi.stubEnv('HOME', home)
  vi.stubEnv('PI_CODING_AGENT_DIR', agentDirectory)
})

afterEach(async () => {
  vi.unstubAllEnvs()
  await fs.rm(home, { recursive: true, force: true })
})

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
    // The flow cancels the paste field once its browser callback finishes the sign-in.
    const browserCallback = new AbortController()
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
          signal: browserCallback.signal,
        }),
      )
    }
    const loginHandlers = handlers()

    await login('anthropic', loginHandlers)

    expect(loginHandlers.onAuthUrl).toHaveBeenCalledWith(
      'https://claude.ai/oauth/authorize?code=true',
      'Open the link in any browser, then paste the code it shows.',
    )
    expect(loginHandlers.onManualCodeInput).toHaveBeenCalledWith(
      { message: 'Paste the authorization code', placeholder: 'code#state' },
      browserCallback.signal,
    )
    expect(answers).toEqual(['pasted-code'])
  })

  it('asks for text and secrets with their own wording, masking secrets and allowing blank text', async () => {
    runtime.login = async (_provider, _type, interaction) => {
      await interaction.prompt({ type: 'text', message: 'Radius workspace URL' })
      await interaction.prompt({ type: 'secret', message: 'Paste your token' })
    }
    const loginHandlers = handlers()

    await login('radius', loginHandlers)

    expect(loginHandlers.onPrompt).toHaveBeenNthCalledWith(
      1,
      {
        message: 'Radius workspace URL',
        secret: false,
        allowEmpty: true,
      },
      undefined,
    )
    expect(loginHandlers.onPrompt).toHaveBeenNthCalledWith(
      2,
      {
        message: 'Paste your token',
        secret: true,
      },
      undefined,
    )
  })

  it('gives login flows a stable installation device ID that Pi persists', async () => {
    const deviceIds: string[] = []
    runtime.login = async (_provider, _type, _interaction, options) => {
      const deviceId = options?.getDeviceId?.()
      if (deviceId) deviceIds.push(deviceId, options?.getDeviceId?.() ?? '')
    }

    await login('openai-chatgpt', handlers())
    await login('openai-chatgpt', handlers())

    const [first] = deviceIds
    expect(first).toMatch(UUID_PATTERN)
    expect(deviceIds).toEqual([first, first, first, first])
    const stored: unknown = JSON.parse(
      await fs.readFile(path.join(agentDirectory, 'settings.json'), 'utf8'),
    )
    expect(stored).toMatchObject({ deviceId: first })
  })

  it('keeps the device ID it created when the sign-in fails, and reports the failure', async () => {
    let deviceId: string | undefined
    runtime.login = async (_provider, _type, _interaction, options) => {
      deviceId = options?.getDeviceId?.()
      throw new Error('Login cancelled')
    }

    await expect(login('openai-chatgpt', handlers())).rejects.toThrow('Login cancelled')

    expect(deviceId).toMatch(UUID_PATTERN)
    const stored: unknown = JSON.parse(
      await fs.readFile(path.join(agentDirectory, 'settings.json'), 'utf8'),
    )
    expect(stored).toMatchObject({ deviceId })
  })

  it('adds the device ID to existing Pi settings without dropping them', async () => {
    await fs.mkdir(agentDirectory, { recursive: true })
    await fs.writeFile(
      path.join(agentDirectory, 'settings.json'),
      `${JSON.stringify({ defaultThinkingLevel: 'high', theme: 'dark' }, null, 2)}\n`,
    )
    runtime.login = async (_provider, _type, _interaction, options) => {
      options?.getDeviceId?.()
    }

    await login('openai-chatgpt', handlers())

    const stored: unknown = JSON.parse(
      await fs.readFile(path.join(agentDirectory, 'settings.json'), 'utf8'),
    )
    expect(stored).toMatchObject({
      defaultThinkingLevel: 'high',
      theme: 'dark',
      deviceId: expect.stringMatching(UUID_PATTERN),
    })
  })
})
