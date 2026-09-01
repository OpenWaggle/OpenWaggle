import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  fauxAssistantMessage,
  fauxProvider,
  InMemoryCredentialStore,
  type Model,
} from '@earendil-works/pi-ai'
import {
  createAgentSession,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from '@earendil-works/pi-coding-agent'
import { afterEach, describe, expect, it } from 'vitest'

const tempDirectories: string[] = []
const sessions: Array<{ dispose: () => void }> = []

function makeTestApiKeyAuth(name: string, apiKey: string) {
  return {
    apiKey: {
      name,
      async check() {
        return { type: 'api_key' as const, source: 'test' }
      },
      async resolve() {
        return { auth: { apiKey }, source: 'test' }
      },
    },
  }
}

describe('Pi compaction model switching', () => {
  afterEach(() => {
    while (sessions.length > 0) sessions.pop()?.dispose()
    while (tempDirectories.length > 0) {
      const directory = tempDirectories.pop()
      if (directory) rmSync(directory, { recursive: true, force: true })
    }
  })

  it('cold-resumes raw history with the target model when source-model auth is unavailable', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'openwaggle-compaction-switch-'))
    tempDirectories.push(directory)
    const target = fauxProvider({
      provider: 'target-provider',
      models: [{ id: 'target-model', contextWindow: 100_000, maxTokens: 10_000 }],
    })
    const modelRuntime = await ModelRuntime.create({
      credentials: new InMemoryCredentialStore(),
      refreshOnCreate: false,
    })
    modelRuntime.registerNativeProvider(target.provider)
    await modelRuntime.setRuntimeApiKey(target.provider.id, 'target-key')

    const sessionManager = SessionManager.inMemory(directory)
    sessionManager.appendModelChange('source-provider', 'source-model')
    sessionManager.appendMessage({ role: 'user', content: 'raw user context', timestamp: 1 })
    sessionManager.appendMessage({
      role: 'assistant',
      content: [{ type: 'text', text: 'raw assistant context' }],
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
    const settingsManager = SettingsManager.inMemory({
      defaultProvider: 'target-provider',
      defaultModel: 'target-model',
    })

    const { session, modelFallbackMessage } = await createAgentSession({
      cwd: directory,
      agentDir: directory,
      modelRuntime,
      sessionManager,
      settingsManager,
      noTools: 'all',
    })
    sessions.push(session)

    expect(modelFallbackMessage).toContain('Using target-provider/target-model')
    expect(session.model).toMatchObject({ provider: 'target-provider', id: 'target-model' })
    expect(session.messages.map((message) => message.role)).toEqual(['user', 'assistant'])
    expect(session.messages[0]).toMatchObject({ content: 'raw user context' })
    expect(target.state.callCount).toBe(0)

    target.setResponses([fauxAssistantMessage('continued on target')])
    await session.prompt('continue from the reconstructed context')

    expect(target.state.callCount).toBe(1)
    expect(session.messages.at(-1)).toMatchObject({ role: 'assistant' })
  })

  it('treats a credential-specific endpoint change as an incompatible Native identity', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'openwaggle-compaction-endpoint-'))
    tempDirectories.push(directory)
    const target = fauxProvider({
      provider: 'same-provider',
      models: [{ id: 'same-model', contextWindow: 100_000, maxTokens: 10_000 }],
    })
    const effectiveBaseUrl = 'https://credential-endpoint.example.test/v1'
    const modelRuntime = await ModelRuntime.create({
      credentials: new InMemoryCredentialStore(),
      refreshOnCreate: false,
    })
    modelRuntime.registerNativeProvider({
      ...target.provider,
      auth: {
        apiKey: {
          name: 'Test credential endpoint',
          async check() {
            return { type: 'api_key' as const, source: 'test' }
          },
          async resolve() {
            return { auth: { apiKey: 'target-key', baseUrl: effectiveBaseUrl }, source: 'test' }
          },
        },
      },
    })

    const sourceModel = target.getModel()
    expect((await modelRuntime.getAuth(sourceModel))?.auth.baseUrl).toBe(effectiveBaseUrl)
    const registeredModel = modelRuntime.getModel(sourceModel.provider, sourceModel.id)
    expect(registeredModel).toBeDefined()
    expect(registeredModel && (await modelRuntime.getAuth(registeredModel))?.auth.baseUrl).toBe(
      effectiveBaseUrl,
    )
    const sessionManager = SessionManager.inMemory(directory)
    sessionManager.appendModelChange(sourceModel.provider, sourceModel.id)
    sessionManager.appendMessage({ role: 'user', content: 'raw user context', timestamp: 1 })
    sessionManager.appendMessage({
      role: 'assistant',
      content: [{ type: 'text', text: 'raw assistant context' }],
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
        compactionBaseUrl: sourceModel.baseUrl,
        modelId: sourceModel.id,
      },
      items: [{ type: 'compaction', id: 'cmp_1', encrypted_content: 'opaque-checkpoint' }],
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
    expect(session.model?.baseUrl).toBe(effectiveBaseUrl)
    expect(target.state.callCount).toBe(0)
  })

  it.each([
    { name: 'scoped model cycling', scoped: true },
    { name: 'available model cycling', scoped: false },
  ])('reconstructs raw history during $name', async ({ scoped }) => {
    const directory = mkdtempSync(path.join(tmpdir(), 'openwaggle-compaction-cycle-'))
    tempDirectories.push(directory)
    const source = fauxProvider({
      api: 'openai-responses',
      provider: 'source-provider',
      models: [{ id: 'source-model', contextWindow: 100_000, maxTokens: 10_000 }],
    })
    const target = fauxProvider({
      api: 'openai-responses',
      provider: 'target-provider',
      models: [{ id: 'target-model', contextWindow: 100_000, maxTokens: 10_000 }],
    })
    const sourceModel: Model<'openai-responses'> = {
      ...source.getModel(),
      api: 'openai-responses',
      compat: { supportsCompaction: true },
    }
    const targetModel: Model<'openai-responses'> = {
      ...target.getModel(),
      api: 'openai-responses',
    }
    const modelRuntime = await ModelRuntime.create({
      credentials: new InMemoryCredentialStore(),
      refreshOnCreate: false,
    })
    modelRuntime.registerNativeProvider({
      ...source.provider,
      getModels: () => [sourceModel],
      auth: makeTestApiKeyAuth('Source test credential', 'source-key'),
    })
    modelRuntime.registerNativeProvider({
      ...target.provider,
      getModels: () => [targetModel],
      auth: makeTestApiKeyAuth('Target test credential', 'target-key'),
    })
    await modelRuntime.setRuntimeApiKey(source.provider.id, 'source-key')
    await modelRuntime.setRuntimeApiKey(target.provider.id, 'target-key')

    const sessionManager = SessionManager.inMemory(directory)
    sessionManager.appendModelChange(sourceModel.provider, sourceModel.id)
    sessionManager.appendMessage({ role: 'user', content: 'raw user context', timestamp: 1 })
    sessionManager.appendMessage({
      role: 'assistant',
      content: [{ type: 'text', text: 'raw assistant context' }],
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
        compactionBaseUrl: sourceModel.baseUrl,
        modelId: sourceModel.id,
      },
      items: [{ type: 'compaction', id: 'cmp_1', encrypted_content: 'opaque-checkpoint' }],
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
      scopedModels: scoped ? [{ model: sourceModel }, { model: targetModel }] : undefined,
    })
    sessions.push(session)

    expect(JSON.stringify(session.messages)).toContain('opaque-checkpoint')

    const result = await session.cycleModel('forward')

    expect(result?.model).toMatchObject({ provider: 'target-provider', id: 'target-model' })
    expect(session.messages.map((message) => message.role)).toEqual(['user', 'assistant'])
    expect(JSON.stringify(session.messages)).toContain('raw user context')
    expect(JSON.stringify(session.messages)).not.toContain('opaque-checkpoint')
  })
})
