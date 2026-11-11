import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
  InMemoryCredentialStore,
} from '@earendil-works/pi-ai'
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from '@earendil-works/pi-coding-agent'
import { afterEach, describe, expect, it } from 'vitest'
import type { PendingSessionOrchestrationUpdate } from '../../../ports/session-orchestration-update-repository'
import {
  createOrchestrationUpdateExtension,
  deliverOrchestrationUpdates,
} from '../orchestration-update-extension'

const cleanups: (() => void)[] = []

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.()
})

const RUN_ID = 'run-queen'
const RESULT: PendingSessionOrchestrationUpdate = {
  updateId: 'update-epics',
  delegationId: 'delegation-epics',
  workerSessionId: 'worker-epics',
  sourceRunId: 'run-worker',
  state: 'ready_for_review',
  summary: 'Drafted the sourcing epics.',
  createdAt: 1000,
}

function sawResult(context: { readonly messages: readonly unknown[] }) {
  return JSON.stringify(context.messages).includes('Drafted the sourcing epics.')
}

/** A Queen's Pi session with the orchestration update extension, on a faux provider. */
async function createQueenSession() {
  const directory = mkdtempSync(path.join(tmpdir(), 'openwaggle-orchestration-ack-'))
  cleanups.push(() => rmSync(directory, { recursive: true, force: true }))
  const faux = fauxProvider({ provider: 'queen-provider', models: [{ id: 'queen-model' }] })
  const modelRuntime = await ModelRuntime.create({
    credentials: new InMemoryCredentialStore(),
    refreshOnCreate: false,
  })
  modelRuntime.registerNativeProvider(faux.provider)
  await modelRuntime.setRuntimeApiKey(faux.provider.id, 'queen-key')
  const delivered: string[][] = []
  const extension = createOrchestrationUpdateExtension({
    runId: RUN_ID,
    pendingUpdates: [],
    onDelivered: (updateIds) => delivered.push([...updateIds]),
  })
  cleanups.push(extension.close)
  const settingsManager = SettingsManager.inMemory({ retry: { enabled: false } })
  const resourceLoader = new DefaultResourceLoader({
    cwd: directory,
    agentDir: directory,
    settingsManager,
    extensionFactories: [extension.factory],
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
  return { session, faux, delivered }
}

/*
 * A Worker result counts as delivered only once a model request of its parent includes it. One
 * that arrives while the parent writes its final answer ("I'll report back when the Workers are
 * done") is appended after that answer, so no request reads it and it stays pending: that is what
 * lets the Host wake the parent once the Run settles.
 */
describe('Orchestration update delivery to a running parent', () => {
  it('leaves a result that arrived during the final turn unacknowledged', async () => {
    const { session, faux, delivered } = await createQueenSession()
    faux.setResponses([
      () => {
        expect(deliverOrchestrationUpdates(RUN_ID, [RESULT])).toBe(true)
        return fauxAssistantMessage('The Workers are still drafting. I will report back.')
      },
    ])

    await session.prompt('Draft the epics with six Workers.')

    const last = session.sessionManager.getEntries().at(-1)
    expect(last).toMatchObject({
      type: 'custom_message',
      customType: 'openwaggle-orchestration-update',
    })
    expect(delivered).toEqual([])
  })

  it('acknowledges a result the next request of the same Run read', async () => {
    const { session, faux, delivered } = await createQueenSession()
    const read: boolean[] = []
    faux.setResponses([
      (context) => {
        read.push(sawResult(context))
        expect(deliverOrchestrationUpdates(RUN_ID, [RESULT])).toBe(true)
        return fauxAssistantMessage(fauxToolCall('hive', { action: 'wait' }))
      },
      (context) => {
        read.push(sawResult(context))
        return fauxAssistantMessage('The sourcing epics are ready for review.')
      },
    ])

    await session.prompt('Draft the epics with six Workers.')

    expect(read).toEqual([false, true])
    expect(delivered).toEqual([['update-epics']])
  })
})
