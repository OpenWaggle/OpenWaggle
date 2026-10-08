import { MessageId, SessionId, SupportedModelId } from '@shared/types/brand'
import type { SessionDetail } from '@shared/types/session'
import { DEFAULT_SETTINGS } from '@shared/types/settings'
import { fromPartial } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { describe, expect, it, vi } from 'vitest'
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

const REMOVED_VIRTUAL_MODEL = SupportedModelId('qa-router/auto')
const ANSWERING_MODEL = SupportedModelId('fake/fake-model-2')

const TestLayer = Layer.mergeAll(
  // After a restart without its extension, the project's catalog lacks the virtual model.
  Layer.succeed(
    ProviderService,
    fromPartial({ isKnownModel: (modelId: string) => Effect.succeed(modelId === ANSWERING_MODEL) }),
  ),
  Layer.succeed(SettingsService, fromPartial({ get: () => Effect.succeed(DEFAULT_SETTINGS) })),
  Layer.succeed(
    SessionProjectionRepository,
    fromPartial({ assignProvisionalTitle: () => Effect.succeed(false) }),
  ),
  EmptyExtensionRuntimeLayer,
)

function preflightFor(messages: SessionDetail['messages']) {
  state.session = fromPartial<SessionDetail>({ id: SessionId('session-1'), messages })
  return Effect.runPromise(
    loadAgentRunPreflight(
      fromPartial({
        sessionId: SessionId('session-1'),
        model: REMOVED_VIRTUAL_MODEL,
        payload: { text: 'Continue', attachments: [] },
      }),
    ).pipe(Effect.provide(TestLayer)),
  )
}

describe('the Run preflight of a Session whose virtual model is gone', () => {
  it('lets the Run start, so it falls back to the model that answered last', async () => {
    const answered = [
      {
        id: MessageId('assistant-1'),
        role: 'assistant' as const,
        parts: [],
        model: ANSWERING_MODEL,
        createdAt: 2,
      },
    ]

    await expect(preflightFor(answered)).resolves.toMatchObject({ ok: true })
  })

  it('refuses it when nothing has answered, so there is nothing to fall back to', async () => {
    await expect(preflightFor([])).resolves.toMatchObject({
      ok: false,
      result: { outcome: 'invalid-model', message: 'Unknown model: qa-router/auto' },
    })
  })
})
