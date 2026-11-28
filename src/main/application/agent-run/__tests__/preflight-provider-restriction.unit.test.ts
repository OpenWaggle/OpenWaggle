import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { MessageId, SessionId, SupportedModelId } from '@shared/types/brand'
import type { SessionDetail } from '@shared/types/session'
import { DEFAULT_SETTINGS } from '@shared/types/settings'
import { fromPartial } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentKernelService } from '../../../ports/agent-kernel-service'
import { ProviderService } from '../../../ports/provider-service'
import { SessionProjectionRepository } from '../../../ports/session-projection-repository'
import { SettingsService } from '../../../services/settings-service'
import { EmptyExtensionRuntimeLayer } from '../../__tests__/extension-runtime-test-layer'

const state = vi.hoisted(() => {
  const value: { session: SessionDetail | undefined } = { session: undefined }
  return value
})

vi.mock('../../pi-session-projection-refresh', async () => {
  const { succeed } = await import('effect/Effect')
  return { loadSessionForRun: () => succeed(state.session) }
})

const { loadAgentRunPreflight } = await import('../preflight')

const REFUSED_MODEL = SupportedModelId('amazon-bedrock/claude')
const ALLOWED_MODEL = SupportedModelId('anthropic/claude')
const GONE_MODEL = SupportedModelId('qa-router/auto')

// A personal project: the company provider is blocked app-wide, and no scope grants it back.
const settings = {
  ...DEFAULT_SETTINGS,
  enabledModels: [REFUSED_MODEL, ALLOWED_MODEL],
  providerRestrictions: { 'amazon-bedrock': false },
}

function testLayer() {
  return Layer.mergeAll(
    Layer.succeed(
      ProviderService,
      fromPartial({ isKnownModel: (modelId: string) => Effect.succeed(modelId !== GONE_MODEL) }),
    ),
    Layer.succeed(SettingsService, fromPartial({ get: () => Effect.succeed(settings) })),
    Layer.succeed(
      SessionProjectionRepository,
      fromPartial({ assignProvisionalTitle: () => Effect.succeed(false) }),
    ),
    Layer.succeed(
      AgentKernelService,
      fromPartial({ listExtensionCommands: () => Effect.succeed([]) }),
    ),
    EmptyExtensionRuntimeLayer,
  )
}

function answeredBy(model: SupportedModelId) {
  return [
    { id: MessageId('assistant-1'), role: 'assistant' as const, parts: [], model, createdAt: 2 },
  ]
}

describe("an existing Session's Run under its project's provider restriction", () => {
  let projectPath: string

  beforeEach(async () => {
    projectPath = await fs.mkdtemp(path.join(os.tmpdir(), 'run-provider-'))
  })

  afterEach(async () => {
    await fs.rm(projectPath, { recursive: true, force: true })
  })

  function preflight(model: SupportedModelId, messages: SessionDetail['messages'] = []) {
    state.session = fromPartial<SessionDetail>({
      id: SessionId('session-1'),
      projectPath,
      messages,
    })
    return Effect.runPromise(
      loadAgentRunPreflight(
        fromPartial({
          sessionId: SessionId('session-1'),
          model,
          payload: { text: 'Continue', attachments: [] },
        }),
      ).pipe(Effect.provide(testLayer())),
    )
  }

  it('refuses the next Run of a Session whose model uses a provider the project refuses', async () => {
    await expect(preflight(REFUSED_MODEL)).resolves.toMatchObject({
      ok: false,
      result: {
        outcome: 'invalid-model',
        message: expect.stringContaining('provider "amazon-bedrock"'),
      },
    })
  })

  it('lets a Session on an allowed provider run', async () => {
    await expect(preflight(ALLOWED_MODEL)).resolves.toMatchObject({ ok: true })
  })

  it('refuses a gone model whose fallback, the model that answered last, is refused', async () => {
    await expect(preflight(GONE_MODEL, answeredBy(REFUSED_MODEL))).resolves.toMatchObject({
      ok: false,
      result: {
        outcome: 'invalid-model',
        message: expect.stringContaining('provider "amazon-bedrock"'),
      },
    })
  })

  it('keeps an available model running even when an earlier answer came from a refused provider', async () => {
    await expect(preflight(ALLOWED_MODEL, answeredBy(REFUSED_MODEL))).resolves.toMatchObject({
      ok: true,
    })
  })

  it("lets the project's own settings file grant the provider back", async () => {
    await fs.mkdir(path.join(projectPath, '.openwaggle'))
    await fs.writeFile(
      path.join(projectPath, '.openwaggle', 'settings.json'),
      JSON.stringify({ providers: { 'amazon-bedrock': true } }),
    )

    await expect(preflight(REFUSED_MODEL)).resolves.toMatchObject({ ok: true })
  })

  it('fails closed when the project settings file cannot be read', async () => {
    await fs.mkdir(path.join(projectPath, '.openwaggle'))
    await fs.writeFile(
      path.join(projectPath, '.openwaggle', 'settings.json'),
      JSON.stringify({ providers: { only: 'anthropic' } }),
    )

    await expect(preflight(ALLOWED_MODEL)).resolves.toMatchObject({
      ok: false,
      result: {
        outcome: 'invalid-model',
        message: expect.stringContaining('could not be read'),
      },
    })
  })
})
