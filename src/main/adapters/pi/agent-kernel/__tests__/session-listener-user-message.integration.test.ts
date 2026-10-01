import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  type AssistantMessage,
  fauxAssistantMessage,
  fauxProvider,
  InMemoryCredentialStore,
} from '@earendil-works/pi-ai'
import {
  type AgentSession,
  createAgentSession,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from '@earendil-works/pi-coding-agent'
import { PI_WAGGLE_USER_REQUEST_CUSTOM_TYPE } from '@openwaggle/pi-waggle/protocol'
import type { HydratedAgentSendPayload } from '@shared/types/agent'
import { SupportedModelId } from '@shared/types/brand'
import type { AgentTransportEvent, AgentTransportUserMessage } from '@shared/types/stream'
import { afterEach, describe, expect, it } from 'vitest'
import { createPiRunControl } from '../pi-run-control'
import { promptPiSession } from '../run-prompt'
import { createSessionListener } from '../session-listener'
import { projectPiSessionSnapshot } from '../session-projection'
import { buildUserInputProjection } from '../user-input-projection'

const cleanups: Array<() => void> = []

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.()
})

async function createRealPiSession() {
  const directory = mkdtempSync(path.join(tmpdir(), 'openwaggle-user-message-contract-'))
  cleanups.push(() => rmSync(directory, { recursive: true, force: true }))
  const faux = fauxProvider({
    provider: 'contract-provider',
    models: [{ id: 'contract-model', contextWindow: 100_000, maxTokens: 10_000 }],
  })
  const modelRuntime = await ModelRuntime.create({
    credentials: new InMemoryCredentialStore(),
    refreshOnCreate: false,
  })
  modelRuntime.registerNativeProvider(faux.provider)
  await modelRuntime.setRuntimeApiKey(faux.provider.id, 'contract-key')
  const { session } = await createAgentSession({
    cwd: directory,
    agentDir: directory,
    modelRuntime,
    sessionManager: SessionManager.inMemory(directory),
    settingsManager: SettingsManager.inMemory({
      defaultProvider: 'contract-provider',
      defaultModel: 'contract-model',
    }),
    noTools: 'all',
  })
  cleanups.push(() => session.dispose())
  const events: AgentTransportEvent[] = []
  session.subscribe(
    createSessionListener(
      {
        model: SupportedModelId('contract-provider/contract-model'),
        sessionEntries: session.sessionManager,
        onEvent: (event) => events.push(event),
      },
      'run-contract',
    ),
  )
  return { session, faux, model: faux.getModel(), events }
}

function publishedUserMessages(events: readonly AgentTransportEvent[]) {
  return events.flatMap((event) =>
    event.type === 'message_start' && event.role === 'user' && event.userMessage
      ? [event.userMessage]
      : [],
  )
}

/** The persisted user node a published user message must equal: same parts, order, and digest. */
function persistedNode(session: AgentSession, userMessage: AgentTransportUserMessage) {
  const node = projectPiSessionSnapshot(session).nodes[userMessage.sessionNodeCreatedOrder]
  if (!node) throw new Error('The published log order names no persisted node')
  const metadata: { readonly durableTextSha256?: string; readonly waggleInvocation?: unknown } =
    JSON.parse(node.metadataJson)
  const content: { readonly parts: unknown } = JSON.parse(node.contentJson)
  return {
    kind: node.kind,
    published: {
      parts: content.parts,
      sessionNodeCreatedOrder: node.createdOrder,
      ...(metadata.durableTextSha256 ? { durableTextSha256: metadata.durableTextSha256 } : {}),
      ...(metadata.waggleInvocation ? { waggleInvocation: metadata.waggleInvocation } : {}),
    },
  }
}

const notes = {
  id: 'attachment-notes',
  kind: 'text' as const,
  origin: 'user-file' as const,
  name: 'notes.txt',
  path: '/tmp/notes.txt',
  mimeType: 'text/plain',
  sizeBytes: 12,
  extractedText: 'notes body',
  source: null,
}

function payload(text: string): HydratedAgentSendPayload {
  return { text, thinkingLevel: 'off', attachments: [notes] }
}

describe('published user messages against a real Pi session', () => {
  it('equals the persisted nodes of a prompt and of a steer the Run incorporates', async () => {
    const { session, faux, model, events } = await createRealPiSession()
    const control = createPiRunControl(session, new AbortController().signal)
    faux.setResponses([
      async (): Promise<AssistantMessage> => {
        await control.steer(payload('Use the other API'))
        return fauxAssistantMessage('first answer')
      },
      fauxAssistantMessage('steered answer'),
    ])

    await promptPiSession(session, model, payload('Fix the layout'))

    const published = publishedUserMessages(events)
    expect(published).toHaveLength(2)
    for (const userMessage of published) {
      expect(persistedNode(session, userMessage)).toEqual({
        kind: 'user_message',
        published: userMessage,
      })
      expect(userMessage.durableTextSha256).toMatch(/^[a-f0-9]{64}$/)
      expect(JSON.stringify(userMessage)).not.toContain('[Attachment:')
    }
    expect(published.map((userMessage) => userMessage.parts[0])).toEqual([
      { type: 'text', text: 'Fix the layout' },
      { type: 'text', text: 'Use the other API' },
    ])
  })

  it('equals the persisted node of a visible Waggle user request appended while idle', async () => {
    const { session, events } = await createRealPiSession()
    const waggleInvocation = { presetId: 'preset-1', presetName: 'Review pair', source: 'user' }

    await session.sendCustomMessage(
      {
        customType: PI_WAGGLE_USER_REQUEST_CUSTOM_TYPE,
        content: 'Review this',
        display: true,
        details: {
          source: 'openwaggle',
          kind: 'waggle-user-request',
          userInput: buildUserInputProjection(payload('Review this')),
          waggleInvocation,
        },
      },
      { triggerTurn: false },
    )

    const [published] = publishedUserMessages(events)
    if (!published) throw new Error('The Waggle user request was not published')
    expect(published.waggleInvocation).toEqual(waggleInvocation)
    expect(persistedNode(session, published)).toEqual({
      kind: 'user_message',
      published,
    })
  })

  it('equals the persisted node of a visible Waggle request incorporated during a Run', async () => {
    const { session, faux, model, events } = await createRealPiSession()
    const waggleInvocation = { presetId: 'preset-2', presetName: 'Pair', source: 'agent' }
    faux.setResponses([
      async (): Promise<AssistantMessage> => {
        // Streaming: Pi queues the request and appends it only after notifying its end.
        await session.sendCustomMessage(
          {
            customType: PI_WAGGLE_USER_REQUEST_CUSTOM_TYPE,
            content: 'Hand this to the pair',
            display: true,
            details: {
              source: 'openwaggle',
              kind: 'waggle-user-request',
              userInput: buildUserInputProjection(payload('Hand this to the pair')),
              waggleInvocation,
            },
          },
          { triggerTurn: true },
        )
        return fauxAssistantMessage('first answer')
      },
      fauxAssistantMessage('answer after the request'),
    ])

    await promptPiSession(session, model, payload('Start'))

    const published = publishedUserMessages(events).find((message) => message.waggleInvocation)
    if (!published) throw new Error('The Waggle user request was not published')
    expect(persistedNode(session, published)).toEqual({ kind: 'user_message', published })
    expect(published.parts[0]).toEqual({ type: 'text', text: 'Hand this to the pair' })
  })
})
