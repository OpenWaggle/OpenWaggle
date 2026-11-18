import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fauxAssistantMessage, fauxProvider, InMemoryCredentialStore } from '@earendil-works/pi-ai'
import {
  createAgentSession,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from '@earendil-works/pi-coding-agent'
import { HIVE_WAKE_NOTICE_TEXT } from '@shared/constants/hive'
import { SupportedModelId } from '@shared/types/brand'
import type { AgentTransportEvent } from '@shared/types/stream'
import { afterEach, describe, expect, it } from 'vitest'
import {
  HIVE_WAKE_CUSTOM_TYPE,
  HIVE_WAKE_PROMPT,
  promptPiSessionForHiveWake,
} from '../hive-wake-prompt'
import { createSessionListener } from '../session-listener'
import { projectPiSessionSnapshot } from '../session-projection'

const cleanups: (() => void)[] = []

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.()
})

async function createRealPiSession() {
  const directory = mkdtempSync(path.join(tmpdir(), 'openwaggle-hive-wake-prompt-'))
  cleanups.push(() => rmSync(directory, { recursive: true, force: true }))
  const faux = fauxProvider({
    provider: 'wake-provider',
    models: [{ id: 'wake-model', contextWindow: 100_000, maxTokens: 10_000 }],
  })
  const modelRuntime = await ModelRuntime.create({
    credentials: new InMemoryCredentialStore(),
    refreshOnCreate: false,
  })
  modelRuntime.registerNativeProvider(faux.provider)
  await modelRuntime.setRuntimeApiKey(faux.provider.id, 'wake-key')
  const { session } = await createAgentSession({
    cwd: directory,
    agentDir: directory,
    modelRuntime,
    sessionManager: SessionManager.inMemory(directory),
    settingsManager: SettingsManager.inMemory({
      defaultProvider: 'wake-provider',
      defaultModel: 'wake-model',
    }),
    noTools: 'all',
  })
  cleanups.push(() => session.dispose())
  const events: AgentTransportEvent[] = []
  session.subscribe(
    createSessionListener(
      {
        model: SupportedModelId('wake-provider/wake-model'),
        sessionEntries: session.sessionManager,
        onEvent: (event) => events.push(event),
      },
      'run-wake',
    ),
  )
  return { session, faux, events }
}

describe('Hive wake prompt', () => {
  it('starts a turn from a Host-authored message, shown as the Host notice', async () => {
    const { session, faux, events } = await createRealPiSession()
    // The orchestration update the wake Run delivers when it starts, before its prompt.
    await session.sendCustomMessage(
      {
        customType: 'openwaggle-orchestration-update',
        content: 'Worker drafts are ready for review.',
        display: true,
        details: { updateIds: ['update-1'] },
      },
      { deliverAs: 'steer', triggerTurn: false },
    )
    faux.setResponses([fauxAssistantMessage('All six Workers finished; here is the summary.')])

    await promptPiSessionForHiveWake(session)

    const entries = session.sessionManager.getEntries()
    // Pi's own bookkeeping (model, thinking level, system prompt) is not part of the conversation.
    const conversation = entries.flatMap((entry) => {
      if (entry.type === 'custom_message') return [`custom:${entry.customType}`]
      if (entry.type === 'message' && entry.message.role !== 'system') return [entry.message.role]
      return []
    })
    expect(conversation).toEqual([
      'custom:openwaggle-orchestration-update',
      `custom:${HIVE_WAKE_CUSTOM_TYPE}`,
      'assistant',
    ])
    const wake = entries.find(
      (entry) => entry.type === 'custom_message' && entry.customType === HIVE_WAKE_CUSTOM_TYPE,
    )
    expect(wake).toMatchObject({ content: HIVE_WAKE_PROMPT, display: false })
    // The chat shows the Host's notice where a user message would be, never the prompt itself.
    const userRows = events.flatMap((event) =>
      event.type === 'message_start' && event.role === 'user' && event.userMessage
        ? [event.userMessage]
        : [],
    )
    const wakeOrder = entries.findIndex((entry) => entry === wake)
    expect(userRows).toEqual([
      {
        parts: [{ type: 'text', text: HIVE_WAKE_NOTICE_TEXT }],
        sessionNodeCreatedOrder: wakeOrder,
        hiveWake: true,
      },
    ])
    const node = projectPiSessionSnapshot(session).nodes[wakeOrder]
    expect(node).toMatchObject({ kind: 'user_message', role: 'user' })
    expect(JSON.parse(node?.contentJson ?? '{}')).toMatchObject({
      parts: [{ type: 'text', text: HIVE_WAKE_NOTICE_TEXT }],
    })
    expect(JSON.parse(node?.metadataJson ?? '{}')).toMatchObject({ hiveWake: true })
    expect(events.some((event) => event.type === 'agent_end')).toBe(true)
  })
})
