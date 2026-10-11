import { SessionId, SupportedModelId } from '@shared/types/brand'
import type { SessionDetail } from '@shared/types/session'
import { DEFAULT_SETTINGS } from '@shared/types/settings'
import { fromPartial } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { describe, expect, it, vi } from 'vitest'
import { AgentKernelService } from '../../../ports/agent-kernel-service'
import { ProviderService } from '../../../ports/provider-service'
import { SessionProjectionRepository } from '../../../ports/session-projection-repository'
import { SettingsService } from '../../../services/settings-service'
import { EmptyExtensionRuntimeLayer } from '../../__tests__/extension-runtime-test-layer'

vi.mock('../../pi-session-projection-refresh', async () => {
  const { succeed } = await import('effect/Effect')
  return {
    loadSessionForRun: () =>
      succeed(fromPartial<SessionDetail>({ id: SessionId('session-1'), messages: [] })),
  }
})

const { loadAgentRunPreflight } = await import('../preflight')

function preflightTitle(text: string) {
  const assignProvisionalTitle = vi.fn(() => Effect.succeed(true))
  const layer = Layer.mergeAll(
    Layer.succeed(ProviderService, fromPartial({ isKnownModel: () => Effect.succeed(true) })),
    Layer.succeed(SettingsService, fromPartial({ get: () => Effect.succeed(DEFAULT_SETTINGS) })),
    Layer.succeed(SessionProjectionRepository, fromPartial({ assignProvisionalTitle })),
    Layer.succeed(
      AgentKernelService,
      fromPartial({
        listExtensionCommands: () =>
          Effect.succeed([{ name: 'qa-hello', description: 'Say hello' }]),
      }),
    ),
    EmptyExtensionRuntimeLayer,
  )
  return Effect.runPromise(
    loadAgentRunPreflight(
      fromPartial({
        sessionId: SessionId('session-1'),
        model: SupportedModelId('fake/fake-model'),
        payload: { text, attachments: [] },
      }),
    ).pipe(Effect.provide(layer)),
  ).then((result) => ({ result, titled: assignProvisionalTitle.mock.calls.length > 0 }))
}

describe("a Session's first message and its title", () => {
  it('is not titled from an extension command it invokes', async () => {
    const { result, titled } = await preflightTitle('/qa-hello world')

    expect(result).toMatchObject({ ok: true })
    expect(titled).toBe(false)
  })

  it.each(['Hello there', '/not-a-command please'])('is titled from %s', async (text) => {
    expect((await preflightTitle(text)).titled).toBe(true)
  })
})
