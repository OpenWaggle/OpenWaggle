import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  type Context,
  fauxAssistantMessage,
  fauxProvider,
  InMemoryCredentialStore,
  type Message,
} from '@earendil-works/pi-ai'
import {
  createAgentSession,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from '@earendil-works/pi-coding-agent'
import { afterEach, describe, expect, it } from 'vitest'

/**
 * Idle compaction (ADR 0025, amended): Pi asks for the Portable handoff with the Session's own
 * last request, so the long prefix is a prompt cache read, and installs it before the next turn.
 */

const tempDirectories: string[] = []
const sessions: Array<{ dispose: () => void }> = []

afterEach(() => {
  while (sessions.length > 0) sessions.pop()?.dispose()
  while (tempDirectories.length > 0) {
    const directory = tempDirectories.pop()
    if (directory) rmSync(directory, { recursive: true, force: true })
  }
})

function messageText(message: Message | undefined) {
  if (!message) return ''
  if (typeof message.content === 'string') return message.content
  return message.content.map((block) => ('text' in block ? block.text : '')).join('')
}

async function idleSession() {
  const directory = mkdtempSync(path.join(tmpdir(), 'openwaggle-idle-compaction-'))
  tempDirectories.push(directory)
  const faux = fauxProvider({
    provider: 'cached-provider',
    models: [{ id: 'cached-model', contextWindow: 100_000, maxTokens: 4_000 }],
  })
  const modelRuntime = await ModelRuntime.create({
    credentials: new InMemoryCredentialStore(),
    refreshOnCreate: false,
  })
  modelRuntime.registerNativeProvider(faux.provider)
  await modelRuntime.setRuntimeApiKey(faux.provider.id, 'test-key')
  const sessionManager = SessionManager.inMemory(directory)
  const settingsManager = SettingsManager.inMemory({
    compaction: { enabled: true, thresholdPercent: 80, keepRecentTokens: 1 },
    cacheWarming: 'streaming',
  })
  const requests: Context[] = []
  const record = (text: string) => (context: Context) => {
    requests.push(context)
    return fauxAssistantMessage(text)
  }
  faux.setResponses([
    record('First answer'),
    record('HANDOFF: the user asked for the first turn.'),
    record('Second answer'),
  ])
  const { session } = await createAgentSession({
    cwd: directory,
    agentDir: directory,
    // A cache lifetime makes the request one idle compaction can replay.
    model: { ...faux.getModel(), promptCache: { short: 300 } },
    modelRuntime,
    sessionManager,
    settingsManager,
    noTools: 'all',
  })
  sessions.push(session)
  await session.prompt('first turn')
  return { session, sessionManager, requests }
}

describe('idle compaction', () => {
  it('asks for the handoff with the last request as its prefix', async () => {
    const { session, requests } = await idleSession()

    expect(session.idleCompactionCandidate).toMatchObject({ ttlMs: 300_000 })
    const compaction = await session.precomputeIdleCompaction()

    expect(compaction?.summary).toContain('HANDOFF: the user asked for the first turn.')
    const [first, handoff] = requests
    if (!first || !handoff) throw new Error('Expected two requests')
    // Byte-identical prefix: the whole first request, then its answer, then the instruction.
    expect(handoff.messages.slice(0, first.messages.length)).toEqual(first.messages)
    expect(handoff.messages.slice(first.messages.length).map((message) => message.role)).toEqual([
      'assistant',
      'user',
    ])
    expect(messageText(handoff.messages.at(-1))).toContain('CONTEXT CHECKPOINT COMPACTION')
  })

  it('installs the handoff before the next turn, without asking the model again', async () => {
    const { session, sessionManager, requests } = await idleSession()
    const compaction = await session.precomputeIdleCompaction()

    session.setPendingCompaction(compaction)
    await session.prompt('second turn')

    const compactions = sessionManager.getEntries().filter((entry) => entry.type === 'compaction')
    expect(compactions).toHaveLength(1)
    expect(compactions[0]).toMatchObject({ reason: 'threshold' })
    expect(requests).toHaveLength(3)
    const next = JSON.stringify(requests[2]?.messages)
    expect(next).toContain('HANDOFF: the user asked for the first turn.')
    expect(next).toContain('second turn')
  })

  it('drops a handoff the conversation has moved past', async () => {
    const { session, sessionManager } = await idleSession()
    const compaction = await session.precomputeIdleCompaction()
    sessionManager.appendMessage({ role: 'user', content: 'written by pi --resume', timestamp: 1 })
    sessionManager.appendMessage(fauxAssistantMessage('another answer'))

    session.setPendingCompaction(compaction)
    await session.prompt('second turn')

    expect(sessionManager.getEntries().filter((entry) => entry.type === 'compaction')).toHaveLength(
      0,
    )
  })
})
