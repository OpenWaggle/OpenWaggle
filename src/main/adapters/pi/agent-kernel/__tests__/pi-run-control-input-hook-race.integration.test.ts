import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fauxAssistantMessage, fauxProvider, InMemoryCredentialStore } from '@earendil-works/pi-ai'
import {
  createAgentSession,
  DefaultResourceLoader,
  type ExtensionFactory,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from '@earendil-works/pi-coding-agent'
import { afterEach, describe, expect, it } from 'vitest'
import { createPiRunControl } from '../pi-run-control'
import { payload } from './run-orchestration.test-utils'

const cleanups: Array<() => void> = []

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.()
})

function deferred() {
  let resolve = () => {}
  const promise = new Promise<void>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

/**
 * A session whose input hook holds the steering text until the active Run has finished: the
 * steer is accepted while Pi streams, but Pi only decides what to do with it after streaming ended.
 */
async function createRacingSession() {
  const directory = mkdtempSync(path.join(tmpdir(), 'openwaggle-pi-steer-race-'))
  cleanups.push(() => rmSync(directory, { recursive: true, force: true }))
  const faux = fauxProvider({ provider: 'race-provider', models: [{ id: 'race-model' }] })
  const modelRuntime = await ModelRuntime.create({
    credentials: new InMemoryCredentialStore(),
    refreshOnCreate: false,
  })
  modelRuntime.registerNativeProvider(faux.provider)
  await modelRuntime.setRuntimeApiKey(faux.provider.id, 'race-key')
  const firstTurnStarted = deferred()
  const releaseFirstTurn = deferred()
  const runFinished = deferred()
  let modelCalls = 0
  faux.setResponses([
    async () => {
      modelCalls += 1
      firstTurnStarted.resolve()
      await releaseFirstTurn.promise
      return fauxAssistantMessage('first answer')
    },
    () => {
      modelCalls += 1
      return fauxAssistantMessage('a turn the steer must not start')
    },
  ])
  const holdSteerUntilTurnEnds: ExtensionFactory = (pi) => {
    pi.on('input', async (event) => {
      if (event.text !== 'Take the safer path') return undefined
      releaseFirstTurn.resolve()
      await runFinished.promise
      return undefined
    })
  }
  const settingsManager = SettingsManager.inMemory({ retry: { enabled: false } })
  const resourceLoader = new DefaultResourceLoader({
    cwd: directory,
    agentDir: directory,
    settingsManager,
    extensionFactories: [holdSteerUntilTurnEnds],
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
    sessionManager: SessionManager.inMemory(directory),
    settingsManager,
    noTools: 'all',
  })
  await session.bindExtensions({})
  cleanups.push(() => session.dispose())
  return { session, firstTurnStarted, runFinished, modelCalls: () => modelCalls }
}

describe('Pi run control steering through the input hook', () => {
  it('refuses a steer when the turn ends before Pi queues it, instead of starting a new turn', async () => {
    const { session, firstTurnStarted, runFinished, modelCalls } = await createRacingSession()
    const run = session.prompt('Start the work').then(() => runFinished.resolve())
    await firstTurnStarted.promise
    const control = createPiRunControl(session, new AbortController().signal, {
      routeThroughInputHook: true,
    })

    await expect(control.steer(payload('Take the safer path'))).rejects.toThrow(
      'The active Pi session is not ready for steering.',
    )
    await run
    await session.agent.waitForIdle()

    expect(modelCalls()).toBe(1)
  })
})
