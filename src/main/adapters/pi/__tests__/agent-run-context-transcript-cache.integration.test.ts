import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  fauxAssistantMessage,
  fauxProvider,
  getSystemMessageText,
  InMemoryCredentialStore,
  type TranscriptContext,
} from '@earendil-works/pi-ai'
import { resolveTranscript } from '@earendil-works/pi-ai/utils/transcript'
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from '@earendil-works/pi-coding-agent'
import { afterEach, describe, expect, it } from 'vitest'
import { createAgentRunContextExtension } from '../agent-run-context-extension'

const directories: string[] = []
const disposers: Array<() => void> = []

afterEach(() => {
  while (disposers.length > 0) disposers.pop()?.()
  while (directories.length > 0) {
    const directory = directories.pop()
    if (directory) rmSync(directory, { recursive: true, force: true })
  }
})

/** One OpenWaggle Run: a fresh Pi runtime over the persisted transcript, as the Host builds it. */
async function runOnce(directory: string, sessionManager: SessionManager, runId: string) {
  const contexts: TranscriptContext[] = []
  const faux = fauxProvider({
    api: 'openai-completions',
    provider: 'cache-provider',
    models: [{ id: 'cache-model', contextWindow: 100_000, maxTokens: 64 }],
  })
  faux.setResponses([
    (context) => {
      contexts.push(structuredClone(context))
      return fauxAssistantMessage(`done ${runId}`)
    },
  ])
  const modelRuntime = await ModelRuntime.create({
    credentials: new InMemoryCredentialStore(),
    refreshOnCreate: false,
  })
  modelRuntime.registerNativeProvider({
    ...faux.provider,
    auth: {
      apiKey: {
        name: 'Cache test key',
        async check() {
          return { type: 'api_key' as const, source: 'test' }
        },
        async resolve() {
          return { auth: { apiKey: 'test-key' }, source: 'test' }
        },
      },
    },
  })
  const settingsManager = SettingsManager.inMemory({ retry: { enabled: false } })
  const resourceLoader = new DefaultResourceLoader({
    cwd: directory,
    agentDir: directory,
    settingsManager,
    extensionFactories: [
      createAgentRunContextExtension({
        sessionIdentityContext: '- Session ID: queen-1\n- Hive role: Queen',
        agentInstructions: 'Review carefully.',
        runIdentityContext: `OpenWaggle Host-authored Run identity.\n{"runId": ${JSON.stringify(runId)}}`,
      }),
    ],
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
    sessionManager,
    settingsManager,
    noTools: 'all',
  })
  disposers.push(() => session.dispose())
  await session.prompt(`message for ${runId}`)
  const context = contexts.at(-1)
  if (!context) throw new Error(`no provider request for ${runId}`)
  return context
}

function leadingPrompt(context: TranscriptContext) {
  const first = context.messages[0]
  if (first?.role !== 'system') throw new Error('expected a leading system message')
  return getSystemMessageText(first)
}

function laterText(context: TranscriptContext) {
  return JSON.stringify(context.messages.slice(1))
}

/*
 * Pi's own provider transcript, as main's #296 checked it. Most providers do not accept
 * mid-conversation system messages, and pi-ai folds a later system message into the leading
 * prompt for them, so a Run-scoped prompt section would still change their leading prompt. The
 * Run identity therefore travels outside the system prompt (agent-run-identity.ts).
 */
describe('Agent run context and provider prompt caching', () => {
  it('keeps the leading prompt identical across Runs with or without mid-conversation system messages', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'openwaggle-prompt-cache-'))
    directories.push(directory)
    const sessionManager = SessionManager.inMemory(directory)

    const first = await runOnce(directory, sessionManager, 'run-1')
    const second = await runOnce(directory, sessionManager, 'run-2')

    expect(leadingPrompt(first)).not.toContain('run-1')
    expect(leadingPrompt(second)).toBe(leadingPrompt(first))
    // No later system message: nothing for pi-ai to fold into the leading prompt.
    expect(second.messages.slice(1).filter((message) => message.role === 'system')).toEqual([])
    expect(laterText(first)).toContain('\\"runId\\": \\"run-1\\"')
    expect(laterText(second)).toContain('\\"runId\\": \\"run-2\\"')

    for (const supportsMidConversationSystemMessages of [true, false]) {
      expect(leadingPrompt(resolveTranscript(second, supportsMidConversationSystemMessages))).toBe(
        leadingPrompt(first),
      )
    }
  })
})
