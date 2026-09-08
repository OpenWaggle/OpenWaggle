import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  type AssistantMessage,
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
  InMemoryCredentialStore,
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

function assistantWithContextUsage(totalTokens: number): AssistantMessage {
  const message = fauxAssistantMessage('Reached the configured context threshold')
  message.usage = {
    input: totalTokens,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  }
  return message
}

describe('Pi compaction scheduling', () => {
  afterEach(() => {
    while (sessions.length > 0) sessions.pop()?.dispose()
    while (tempDirectories.length > 0) {
      const directory = tempDirectories.pop()
      if (directory) rmSync(directory, { recursive: true, force: true })
    }
  })

  it('waits at an idle threshold and compacts before the next user turn', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'openwaggle-compaction-scheduling-'))
    tempDirectories.push(directory)
    const faux = fauxProvider({
      provider: 'portable-provider',
      models: [{ id: 'portable-model', contextWindow: 100, maxTokens: 20 }],
    })
    const modelRuntime = await ModelRuntime.create({
      credentials: new InMemoryCredentialStore(),
      refreshOnCreate: false,
    })
    modelRuntime.registerNativeProvider(faux.provider)
    await modelRuntime.setRuntimeApiKey(faux.provider.id, 'test-key')
    const sessionManager = SessionManager.inMemory(directory)
    const settingsManager = SettingsManager.inMemory({
      compaction: {
        enabled: true,
        thresholdPercent: 80,
        keepRecentTokens: 1,
        reserveTokens: 20,
      },
    })
    const compactRequest = { text: '' }
    faux.setResponses([
      assistantWithContextUsage(80),
      (context) => {
        compactRequest.text = JSON.stringify(context.messages)
        return fauxAssistantMessage('Portable checkpoint')
      },
      fauxAssistantMessage('Second turn response'),
    ])
    const { session } = await createAgentSession({
      cwd: directory,
      agentDir: directory,
      model: faux.getModel(),
      modelRuntime,
      sessionManager,
      settingsManager,
      noTools: 'all',
    })
    sessions.push(session)

    await session.prompt('first turn')

    expect(sessionManager.getEntries().filter((entry) => entry.type === 'compaction')).toHaveLength(
      0,
    )
    expect(faux.state.callCount).toBe(1)

    await session.prompt('second turn')

    expect(sessionManager.getEntries().filter((entry) => entry.type === 'compaction')).toHaveLength(
      1,
    )
    expect(faux.state.callCount).toBe(3)
    expect(compactRequest.text).toContain('first turn')
    expect(compactRequest.text).not.toContain('second turn')
  })

  it('compacts a large tool loop before its next model call without splitting the tool pair', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'openwaggle-compaction-tool-loop-'))
    tempDirectories.push(directory)
    writeFileSync(path.join(directory, 'large.txt'), `large-tool-result-${'z'.repeat(4_000)}`)
    const faux = fauxProvider({
      provider: 'portable-provider',
      models: [{ id: 'portable-model', contextWindow: 1_000, maxTokens: 200 }],
    })
    const modelRuntime = await ModelRuntime.create({
      credentials: new InMemoryCredentialStore(),
      refreshOnCreate: false,
    })
    modelRuntime.registerNativeProvider(faux.provider)
    await modelRuntime.setRuntimeApiKey(faux.provider.id, 'test-key')
    const sessionManager = SessionManager.inMemory(directory)
    sessionManager.appendModelChange('portable-provider', 'portable-model')
    sessionManager.appendMessage({
      role: 'user',
      content: `old-user-${'x'.repeat(4_000)}`,
      timestamp: 1,
    })
    sessionManager.appendMessage({
      ...assistantWithContextUsage(2),
      content: [{ type: 'text', text: `old-assistant-${'y'.repeat(6_000)}` }],
      provider: 'portable-provider',
      model: 'portable-model',
      timestamp: 2,
    })
    const settingsManager = SettingsManager.inMemory({
      compaction: {
        enabled: true,
        thresholdPercent: 80,
        keepRecentTokens: 2_000,
        reserveTokens: 200,
      },
    })
    const continuationContext = { text: '' }
    faux.setResponses([
      fauxAssistantMessage(fauxToolCall('read', { path: 'large.txt' }, { id: 'tool-large' }), {
        stopReason: 'toolUse',
      }),
      fauxAssistantMessage('Portable history checkpoint'),
      fauxAssistantMessage('Portable turn-prefix checkpoint'),
      (context) => {
        continuationContext.text = JSON.stringify(context.messages)
        return fauxAssistantMessage('Tool loop complete')
      },
    ])
    const { session } = await createAgentSession({
      cwd: directory,
      agentDir: directory,
      model: faux.getModel(),
      modelRuntime,
      sessionManager,
      settingsManager,
    })
    sessions.push(session)

    await session.prompt('run the large result tool')

    expect(faux.state.callCount).toBe(4)
    const entries = sessionManager.getEntries()
    const toolCallIndex = entries.findIndex(
      (entry) =>
        entry.type === 'message' &&
        entry.message.role === 'assistant' &&
        entry.message.content.some(
          (block) => block.type === 'toolCall' && block.id === 'tool-large',
        ),
    )
    const toolResultIndex = entries.findIndex(
      (entry) =>
        entry.type === 'message' &&
        entry.message.role === 'toolResult' &&
        entry.message.toolCallId === 'tool-large',
    )
    const compactionIndex = entries.findIndex((entry) => entry.type === 'compaction')
    expect(toolCallIndex).toBeGreaterThan(-1)
    expect(toolResultIndex).toBe(toolCallIndex + 1)
    expect(compactionIndex).toBe(toolResultIndex + 1)
    expect(continuationContext.text).toContain('read')
    expect(continuationContext.text).toContain('large-tool-result-')
  })
})
