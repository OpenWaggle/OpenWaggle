import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  type AssistantMessage,
  contentText,
  fauxAssistantMessage,
  fauxProvider,
  InMemoryCredentialStore,
  type TranscriptContext,
} from '@earendil-works/pi-ai'
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from '@earendil-works/pi-coding-agent'
import { createPiWaggleExtension } from '@openwaggle/pi-waggle/loop'
import type { WaggleConfig } from '@openwaggle/waggle-core'
import { afterEach, describe, expect, it } from 'vitest'

const cleanups: Array<() => void> = []
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.()
})

const MODEL = 'turn-provider/turn-model'
const CONFIG: WaggleConfig = {
  mode: 'sequential',
  agents: [
    { label: 'Architect', model: MODEL, roleDescription: 'Designs', color: 'blue' },
    { label: 'Reviewer', model: MODEL, roleDescription: 'Reviews', color: 'amber' },
  ],
  stop: { primary: 'consensus', maxTurnsSafety: 3 },
}

type Reply = (context: TranscriptContext) => AssistantMessage

/** A three-turn Waggle Run through pi-waggle's own loop, with Pi's automatic retry on. */
async function waggleRun(replies: readonly Reply[]) {
  const directory = mkdtempSync(path.join(tmpdir(), 'openwaggle-waggle-retry-'))
  cleanups.push(() => rmSync(directory, { recursive: true, force: true }))
  const faux = fauxProvider({
    provider: 'turn-provider',
    models: [{ id: 'turn-model', contextWindow: 100_000, maxTokens: 10_000 }],
  })
  const modelRuntime = await ModelRuntime.create({
    credentials: new InMemoryCredentialStore(),
    refreshOnCreate: false,
  })
  modelRuntime.registerNativeProvider(faux.provider)
  await modelRuntime.setRuntimeApiKey(faux.provider.id, 'turn-key')
  const completedTurns: Array<{ turn: number; stopReasons: string[] }> = []
  const waggle = createPiWaggleExtension<{ turnNumber: number }>({
    config: CONFIG,
    createTurnMetadata: ({ turnNumber }) => ({ turnNumber }),
    onTurnComplete: ({ meta, messages }) => {
      completedTurns.push({
        turn: meta.turnNumber,
        stopReasons: messages.flatMap((message) =>
          message.role === 'assistant' ? [message.stopReason] : [],
        ),
      })
      return { continue: true }
    },
    buildTurnMessage: ({ turn }) => ({
      customType: 'pi-waggle.turn',
      content: `Turn ${turn.turnNumber}`,
      display: false,
    }),
  })
  const settingsManager = SettingsManager.inMemory({
    retry: { enabled: true, maxRetries: 2, baseDelayMs: 1 },
  })
  const resourceLoader = new DefaultResourceLoader({
    cwd: directory,
    agentDir: directory,
    settingsManager,
    extensionFactories: [waggle.factory],
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
  })
  await resourceLoader.reload()
  const { session } = await createAgentSession({
    cwd: directory,
    agentDir: directory,
    model: faux.getModel(),
    modelRuntime,
    resourceLoader,
    sessionManager: SessionManager.create(directory, directory),
    settingsManager,
    noTools: 'all',
  })
  cleanups.push(() => session.dispose())
  const requests: string[] = []
  faux.setResponses(
    replies.map((reply) => (context: TranscriptContext) => {
      requests.push(
        context.messages
          .filter((message) => message.role === 'user')
          .map((message) => contentText(message.content))
          .join(' | '),
      )
      return reply(context)
    }),
  )
  await session.bindExtensions({})
  await session.sendCustomMessage(
    { customType: 'pi-waggle.turn', content: 'Turn 0', display: false },
    { triggerTurn: true },
  )
  await waggle.done
  await session.waitForIdle()
  return { completedTurns, requests }
}

const answer =
  (text: string): Reply =>
  () =>
    fauxAssistantMessage(text)
const unavailable: Reply = () =>
  fauxAssistantMessage('', { stopReason: 'error', errorMessage: '503 Service Unavailable' })

describe('a Waggle turn Pi retries', () => {
  it('advances once Pi has retried, not on the failed attempt (a plain 503)', async () => {
    const { completedTurns, requests } = await waggleRun([
      answer('Turn 0 answer'),
      unavailable,
      answer('Turn 1 retried answer'),
      answer('Turn 2 answer'),
    ])

    expect(completedTurns).toEqual([
      { turn: 0, stopReasons: ['stop'] },
      { turn: 1, stopReasons: ['stop'] },
      { turn: 2, stopReasons: ['stop'] },
    ])
    // The next turn's message was not steered into Pi's retry of the failed one.
    expect(requests).toHaveLength(4)
    expect(requests[2]).not.toContain('Turn 2')
    expect(requests[3]).toContain('Turn 2')
  })
})
