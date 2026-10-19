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

const cleanups: Array<() => void> = []

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.()
})

/** How long the gate would run if nothing stopped it; the test fails long before. */
const GATE_DURATION_MS = 60_000

function deferred() {
  let resolve = () => {}
  const promise = new Promise<void>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

/**
 * A session with a project extension that runs a slow check in `agent_before_settle`, as the gosafe
 * club-hooks lint and type-check gate does, honouring `ctx.signal`.
 */
async function createSessionWithSlowBeforeSettleGate() {
  const directory = mkdtempSync(path.join(tmpdir(), 'openwaggle-pi-before-settle-'))
  cleanups.push(() => rmSync(directory, { recursive: true, force: true }))
  const faux = fauxProvider({ provider: 'settle-provider', models: [{ id: 'settle-model' }] })
  const modelRuntime = await ModelRuntime.create({
    credentials: new InMemoryCredentialStore(),
    refreshOnCreate: false,
  })
  modelRuntime.registerNativeProvider(faux.provider)
  await modelRuntime.setRuntimeApiKey(faux.provider.id, 'settle-key')
  faux.setResponses([() => fauxAssistantMessage('the answer')])

  const gateStarted = deferred()
  const observed: { signal?: AbortSignal; abortedWhenDone?: boolean } = {}
  const slowGate: ExtensionFactory = (pi) => {
    pi.on('agent_before_settle', async (_event, ctx) => {
      const signal = ctx.signal
      observed.signal = signal
      gateStarted.resolve()
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, GATE_DURATION_MS)
        signal?.addEventListener(
          'abort',
          () => {
            clearTimeout(timer)
            resolve()
          },
          { once: true },
        )
      })
      observed.abortedWhenDone = signal?.aborted
      return undefined
    })
  }
  const settingsManager = SettingsManager.inMemory({ retry: { enabled: false } })
  const resourceLoader = new DefaultResourceLoader({
    cwd: directory,
    agentDir: directory,
    settingsManager,
    extensionFactories: [slowGate],
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
  return { session, gateStarted, observed }
}

/*
 * OpenWaggle's Pi patch: `ctx.signal` is Pi's agent-loop signal, which no longer exists once the
 * loop returned, so a before-settle handler could not observe Stop and the Run sat in "Finishing"
 * until the handler returned.
 */
describe('Pi agent_before_settle abort', () => {
  it('gives before-settle handlers a signal that Stop aborts, so the Run ends promptly', async () => {
    const { session, gateStarted, observed } = await createSessionWithSlowBeforeSettleGate()
    const settled: boolean[] = []
    session.subscribe((event) => {
      if (event.type === 'agent_settled') settled.push(event.aborted)
    })

    const run = session.prompt('Do the work')
    await gateStarted.promise

    expect(observed.signal).toBeInstanceOf(AbortSignal)
    expect(observed.signal?.aborted).toBe(false)

    const startedStopping = Date.now()
    await session.abort()
    await run

    expect(Date.now() - startedStopping).toBeLessThan(GATE_DURATION_MS / 2)
    expect(observed.abortedWhenDone).toBe(true)
    expect(settled).toEqual([true])
    expect(session.isIdle).toBe(true)
  })
})
