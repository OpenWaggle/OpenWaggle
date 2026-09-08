import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fauxProvider, InMemoryCredentialStore, type Model } from '@earendil-works/pi-ai'
import {
  createAgentSession,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from '@earendil-works/pi-coding-agent'
import { afterEach, describe, expect, it } from 'vitest'

const tempDirectories: string[] = []
const sessions: Array<{ dispose: () => void }> = []

describe('Pi empty reconstruction restoration', () => {
  afterEach(() => {
    while (sessions.length > 0) sessions.pop()?.dispose()
    while (tempDirectories.length > 0) {
      const directory = tempDirectories.pop()
      if (directory) rmSync(directory, { recursive: true, force: true })
    }
  })

  it('does not initialize a new session when reconstruction fits zero messages', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'openwaggle-empty-reconstruction-'))
    tempDirectories.push(directory)
    const target = fauxProvider({
      api: 'openai-responses',
      provider: 'tiny-target-provider',
      models: [{ id: 'tiny-target-model', contextWindow: 20, maxTokens: 20 }],
    })
    const targetModel: Model<'openai-responses'> = {
      ...target.getModel(),
      api: 'openai-responses',
    }
    const modelRuntime = await ModelRuntime.create({
      credentials: new InMemoryCredentialStore(),
      refreshOnCreate: false,
    })
    modelRuntime.registerNativeProvider(target.provider)
    await modelRuntime.setRuntimeApiKey(target.provider.id, 'target-key')

    const sessionManager = SessionManager.inMemory(directory)
    sessionManager.appendModelChange('source-provider', 'source-model')
    sessionManager.appendThinkingLevelChange('off')
    sessionManager.appendMessage({
      role: 'user',
      content: 'oversized raw user context '.repeat(100),
      timestamp: 1,
    })
    sessionManager.appendMessage({
      role: 'assistant',
      content: [{ type: 'text', text: 'oversized raw assistant context '.repeat(100) }],
      api: 'openai-responses',
      provider: 'source-provider',
      model: 'source-model',
      usage: {
        input: 1,
        output: 1,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 2,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: 'stop',
      timestamp: 2,
    })
    sessionManager.appendCompaction('Native compaction checkpoint', 'native-replacement', 80_000, {
      schemaVersion: 1,
      mechanism: 'native',
      identity: {
        api: 'openai-responses',
        provider: 'source-provider',
        baseUrl: 'https://source.example.test/v1',
        compactionBaseUrl: 'https://source.example.test/v1',
        modelId: 'source-model',
      },
      items: [{ type: 'compaction', id: 'cmp_1', encrypted_content: 'opaque-checkpoint' }],
    })
    const entriesBeforeOpen = sessionManager.getEntries()

    const { session } = await createAgentSession({
      cwd: directory,
      agentDir: directory,
      model: targetModel,
      modelRuntime,
      sessionManager,
      settingsManager: SettingsManager.inMemory(),
      noTools: 'all',
    })
    sessions.push(session)

    expect(session.messages).toEqual([])
    expect(sessionManager.getEntries()).toEqual(entriesBeforeOpen)
    expect(target.state.callCount).toBe(0)
  })
})
