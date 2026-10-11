import type { PreparedAttachment } from '@shared/types/agent'
import { MessageId, SessionId, SupportedModelId } from '@shared/types/brand'
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

const state = vi.hoisted(() => {
  const value: { messages: SessionDetail['messages'] } = { messages: [] }
  return value
})

vi.mock('../../pi-session-projection-refresh', async () => {
  const { succeed } = await import('effect/Effect')
  return {
    loadSessionForRun: () =>
      succeed(
        fromPartial<SessionDetail>({
          id: SessionId('session-1'),
          titleSource: 'default',
          messages: state.messages,
        }),
      ),
  }
})

const { loadAgentRunPreflight } = await import('../preflight')

function preflightTitle(
  text: string,
  messages: SessionDetail['messages'] = [],
  attachments: readonly PreparedAttachment[] = [],
) {
  state.messages = messages
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
        payload: { text, attachments },
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

  // Pi runs a command only from a message that starts with it, as typed.
  // Pi parses the prompt OpenWaggle sends: trimmed, with each attachment appended.
  it('is not titled from a command typed after leading space', async () => {
    expect((await preflightTitle('  /qa-hello world  ')).titled).toBe(false)
  })

  it('is titled from a command name an attachment runs into, which Pi does not run', async () => {
    const attachment = fromPartial<PreparedAttachment>({ name: 'notes.txt', extractedText: '' })

    expect((await preflightTitle('/qa-hello', [], [attachment])).titled).toBe(true)
  })

  it.each(['Hello there', '/not-a-command please', '/qa-hello\tworld'])(
    'is titled from %j',
    async (text) => {
      expect((await preflightTitle(text)).titled).toBe(true)
    },
  )

  it('is titled from the first real prompt after a command that sent a turn', async () => {
    // The command's turn left messages but no title.
    const commandTurn = [
      { id: MessageId('assistant-1'), role: 'assistant' as const, parts: [], createdAt: 2 },
    ]

    const { titled } = await preflightTitle('Now review the migration', commandTurn)

    expect(titled).toBe(true)
  })
})
