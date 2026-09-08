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

describe('Pi compaction offline restoration', () => {
  afterEach(() => {
    while (sessions.length > 0) sessions.pop()?.dispose()
    while (tempDirectories.length > 0) {
      const directory = tempDirectories.pop()
      if (directory) rmSync(directory, { recursive: true, force: true })
    }
  })

  it('cold-resumes raw history when Native checkpoint authentication is unavailable', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'openwaggle-compaction-offline-resume-'))
    tempDirectories.push(directory)
    const source = fauxProvider({
      api: 'openai-responses',
      provider: 'offline-source-provider',
      models: [{ id: 'source-model', contextWindow: 100_000, maxTokens: 10_000 }],
    })
    const sourceModel: Model<'openai-responses'> = {
      ...source.getModel(),
      api: 'openai-responses',
      compat: { supportsCompaction: true },
    }
    const modelRuntime = await ModelRuntime.create({
      credentials: new InMemoryCredentialStore(),
      refreshOnCreate: false,
    })
    modelRuntime.registerNativeProvider({
      ...source.provider,
      getModels: () => [sourceModel],
      auth: {
        apiKey: {
          name: 'Unavailable test credential',
          async check() {
            return { type: 'api_key' as const, source: 'test' }
          },
          async resolve() {
            throw new Error('credential refresh unavailable')
          },
        },
      },
    })

    const sessionManager = SessionManager.inMemory(directory)
    sessionManager.appendModelChange(sourceModel.provider, sourceModel.id)
    sessionManager.appendMessage({ role: 'user', content: 'raw offline context', timestamp: 1 })
    sessionManager.appendMessage({
      role: 'assistant',
      content: [{ type: 'text', text: 'raw offline response' }],
      api: sourceModel.api,
      provider: sourceModel.provider,
      model: sourceModel.id,
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
        api: sourceModel.api,
        provider: sourceModel.provider,
        baseUrl: sourceModel.baseUrl,
        modelId: sourceModel.id,
      },
      items: [{ type: 'compaction', id: 'cmp_offline', encrypted_content: 'opaque-offline' }],
    })
    const settingsManager = SettingsManager.inMemory({
      defaultProvider: sourceModel.provider,
      defaultModel: sourceModel.id,
    })

    const { session } = await createAgentSession({
      cwd: directory,
      agentDir: directory,
      model: sourceModel,
      modelRuntime,
      sessionManager,
      settingsManager,
      noTools: 'all',
    })
    sessions.push(session)

    expect(session.messages.map((message) => message.role)).toEqual(['user', 'assistant'])
    expect(JSON.stringify(session.messages)).toContain('raw offline context')
    expect(JSON.stringify(session.messages)).not.toContain('opaque-offline')
    expect(source.state.callCount).toBe(0)
  })

  it('cold-resumes raw history when Native checkpoint credentials are not configured', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'openwaggle-compaction-no-auth-resume-'))
    tempDirectories.push(directory)
    const source = fauxProvider({
      api: 'openai-responses',
      provider: 'unconfigured-source-provider',
      models: [{ id: 'source-model', contextWindow: 100, maxTokens: 20 }],
    })
    const sourceModel: Model<'openai-responses'> = {
      ...source.getModel(),
      api: 'openai-responses',
      compat: { supportsCompaction: true },
    }
    const modelRuntime = await ModelRuntime.create({
      credentials: new InMemoryCredentialStore(),
      refreshOnCreate: false,
    })
    modelRuntime.registerNativeProvider({
      ...source.provider,
      getModels: () => [sourceModel],
      auth: {},
    })
    expect(await modelRuntime.getAuth(sourceModel)).toBeUndefined()

    const sessionManager = SessionManager.inMemory(directory)
    sessionManager.appendModelChange(sourceModel.provider, sourceModel.id)
    sessionManager.appendMessage({ role: 'user', content: 'old '.repeat(500), timestamp: 1 })
    sessionManager.appendMessage({
      role: 'assistant',
      content: [{ type: 'text', text: 'old response '.repeat(500) }],
      api: sourceModel.api,
      provider: sourceModel.provider,
      model: sourceModel.id,
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
    sessionManager.appendMessage({ role: 'user', content: 'raw no-auth context', timestamp: 1 })
    sessionManager.appendMessage({
      role: 'assistant',
      content: [{ type: 'text', text: 'raw no-auth response' }],
      api: sourceModel.api,
      provider: sourceModel.provider,
      model: sourceModel.id,
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
        api: sourceModel.api,
        provider: sourceModel.provider,
        baseUrl: sourceModel.baseUrl,
        modelId: sourceModel.id,
      },
      items: [{ type: 'compaction', id: 'cmp_no_auth', encrypted_content: 'opaque-no-auth' }],
    })

    const { session } = await createAgentSession({
      cwd: directory,
      agentDir: directory,
      model: sourceModel,
      modelRuntime,
      sessionManager,
      settingsManager: SettingsManager.inMemory({
        defaultProvider: sourceModel.provider,
        defaultModel: sourceModel.id,
      }),
      noTools: 'all',
    })
    sessions.push(session)

    expect(JSON.stringify(session.messages)).toContain('raw no-auth context')
    expect(JSON.stringify(session.messages)).not.toContain('old response')
    expect(JSON.stringify(session.messages)).not.toContain('opaque-no-auth')
    expect(
      sessionManager
        .getEntries()
        .filter(
          (entry) => entry.type === 'custom' && entry.customType === 'pi.compaction_reconstruction',
        ),
    ).toHaveLength(0)
    expect(source.state.callCount).toBe(0)
  })
})
