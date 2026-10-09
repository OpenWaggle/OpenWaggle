import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  type AssistantMessage,
  collapseSystemMessages,
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
  getInitialSystemMessage,
  getSystemMessageText,
  InMemoryCredentialStore,
  type TranscriptContext,
} from '@earendil-works/pi-ai'
import {
  type AgentSessionEvent,
  createAgentSession,
  DefaultResourceLoader,
  type ExtensionError,
  type ExtensionFactory,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from '@earendil-works/pi-coding-agent'
import { Type } from 'typebox'
import { afterEach, describe, expect, it, vi } from 'vitest'

const cleanups: Array<() => void> = []
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.()
})

/**
 * Two turns the way pi-waggle runs them: the first ends, and its `agent_end` handler starts the
 * next with `pi.sendMessage(..., { triggerTurn: true })` on a timer, and never waits for that turn.
 */
async function twoTurnSession(
  failSecondTurnAuth: boolean,
  options: {
    readonly authError?: string
    readonly retry?: boolean
    readonly toolCallAfterRetry?: boolean
  } = {},
) {
  const directory = mkdtempSync(path.join(tmpdir(), 'openwaggle-custom-turn-failure-'))
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
  let failNextAuth = false
  // The request auth the turn's preparation reads (`_prepareNewTurn`).
  const prepareModelRequest = modelRuntime.prepareModelRequest.bind(modelRuntime)
  vi.spyOn(modelRuntime, 'prepareModelRequest').mockImplementation(async (...args) => {
    if (failNextAuth) {
      failNextAuth = false
      throw new Error(options.authError ?? 'Sign-in expired for turn-provider')
    }
    return prepareModelRequest(...args)
  })
  let continued = false
  const continueOnce: ExtensionFactory = (pi) => {
    // A turn's own prompt section, as OpenWaggle's and Pi's handlers set them.
    pi.on('before_agent_start', (event) => {
      event.systemPromptOptions.sections.turn_prompt = `For ${event.prompt}`
    })
    pi.registerTool({
      name: 'ping',
      label: 'ping',
      description: 'Answers pong.',
      parameters: Type.Object({}),
      execute: async () => ({ content: [{ type: 'text', text: 'pong' }], details: {} }),
    })
    pi.on('agent_end', () => {
      if (continued) return
      continued = true
      failNextAuth = failSecondTurnAuth
      // As pi-waggle's loop dispatches the next turn, once the finished one has settled.
      setTimeout(() => {
        pi.sendMessage(
          { customType: 'pi-waggle.turn', content: 'Turn 1', display: false },
          { triggerTurn: true },
        )
      }, 0)
    })
  }
  const settingsManager = SettingsManager.inMemory({
    retry: options.retry ? { enabled: true, maxRetries: 2, baseDelayMs: 1 } : { enabled: false },
  })
  const resourceLoader = new DefaultResourceLoader({
    cwd: directory,
    agentDir: directory,
    settingsManager,
    extensionFactories: [continueOnce],
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
    tools: ['ping'],
  })
  cleanups.push(() => session.dispose())
  const requests: TranscriptContext[] = []
  const answer = (text: string) => (context: TranscriptContext) => {
    requests.push(context)
    return fauxAssistantMessage(text)
  }
  faux.setResponses([
    answer('Turn 0 answer'),
    ...(options.toolCallAfterRetry
      ? [
          (context: TranscriptContext) => {
            requests.push(context)
            return fauxAssistantMessage(fauxToolCall('ping', {}, { id: 'ping-1' }), {
              stopReason: 'toolUse',
            })
          },
        ]
      : []),
    answer('Turn 1 answer'),
  ])
  const extensionErrors: ExtensionError[] = []
  await session.bindExtensions({ onError: (error) => extensionErrors.push(error) })
  const agentEnds: AssistantMessage[][] = []
  session.subscribe((event: AgentSessionEvent) => {
    if (event.type !== 'agent_end') return
    agentEnds.push(
      event.messages.filter((message): message is AssistantMessage => message.role === 'assistant'),
    )
  })
  return { session, agentEnds, extensionErrors, requests }
}

describe('a turn started with a custom message', () => {
  it('ends as an error turn when its preparation fails, instead of never starting', async () => {
    const { session, agentEnds, extensionErrors } = await twoTurnSession(true)

    await session.sendCustomMessage(
      { customType: 'pi-waggle.turn', content: 'Turn 0', display: false },
      { triggerTurn: true },
    )
    await vi.waitFor(() => expect(agentEnds).toHaveLength(2))
    await session.waitForIdle()

    expect(agentEnds[1]).toMatchObject([
      { stopReason: 'error', errorMessage: 'Sign-in expired for turn-provider' },
    ])
    expect(extensionErrors).toEqual([])
  })

  it('runs the next turn as usual when its preparation succeeds', async () => {
    const { session, agentEnds } = await twoTurnSession(false)

    await session.sendCustomMessage(
      { customType: 'pi-waggle.turn', content: 'Turn 0', display: false },
      { triggerTurn: true },
    )
    await vi.waitFor(() => expect(agentEnds).toHaveLength(2))

    expect(agentEnds[1]).toMatchObject([{ stopReason: 'stop' }])
  })

  it("retries a turn whose preparation failed retryably with the turn's own prompt", async () => {
    const { session, agentEnds, requests } = await twoTurnSession(true, {
      authError: 'fetch failed',
      retry: true,
      toolCallAfterRetry: true,
    })

    await session.sendCustomMessage(
      { customType: 'pi-waggle.turn', content: 'Turn 0', display: false },
      { triggerTurn: true },
    )
    await vi.waitFor(() => expect(requests).toHaveLength(3))
    await session.waitForIdle()

    // Pi retried the failed turn, which then called a tool: both requests have the section the
    // turn's handlers set.
    for (const request of requests.slice(1)) {
      const prompt = getSystemMessageText(
        getInitialSystemMessage(collapseSystemMessages(request).messages) ?? {
          role: 'system',
          content: '',
          timestamp: 0,
        },
      )
      expect(prompt).toContain('For Turn 1')
      expect(prompt).not.toContain('For Turn 0')
    }
    expect(agentEnds.at(-1)?.at(-1)).toMatchObject({ stopReason: 'stop' })
  })
})
