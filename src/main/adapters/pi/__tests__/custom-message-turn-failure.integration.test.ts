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
  type AgentSessionEvent,
  createAgentSession,
  DefaultResourceLoader,
  type ExtensionError,
  type ExtensionFactory,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from '@earendil-works/pi-coding-agent'
import { afterEach, describe, expect, it, vi } from 'vitest'

const cleanups: Array<() => void> = []
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.()
})

/**
 * Two turns the way pi-waggle runs them: the first ends, and its `agent_end` handler starts the
 * next with `pi.sendMessage(..., { triggerTurn: true })` on a timer, and never waits for that turn.
 */
async function twoTurnSession(failSecondTurnAuth: boolean) {
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
      throw new Error('Sign-in expired for turn-provider')
    }
    return prepareModelRequest(...args)
  })
  let continued = false
  const continueOnce: ExtensionFactory = (pi) => {
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
  const settingsManager = SettingsManager.inMemory({ retry: { enabled: false } })
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
    noTools: 'all',
  })
  cleanups.push(() => session.dispose())
  faux.setResponses([fauxAssistantMessage('Turn 0 answer'), fauxAssistantMessage('Turn 1 answer')])
  const extensionErrors: ExtensionError[] = []
  await session.bindExtensions({ onError: (error) => extensionErrors.push(error) })
  const agentEnds: AssistantMessage[][] = []
  session.subscribe((event: AgentSessionEvent) => {
    if (event.type !== 'agent_end') return
    agentEnds.push(
      event.messages.filter((message): message is AssistantMessage => message.role === 'assistant'),
    )
  })
  return { session, agentEnds, extensionErrors }
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
})
