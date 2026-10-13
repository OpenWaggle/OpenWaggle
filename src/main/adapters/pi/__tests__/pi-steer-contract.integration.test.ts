import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fauxProvider, InMemoryCredentialStore } from '@earendil-works/pi-ai'
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

async function createSession(extensionFactories: ExtensionFactory[] = []) {
  const directory = mkdtempSync(path.join(tmpdir(), 'openwaggle-pi-steer-contract-'))
  cleanups.push(() => rmSync(directory, { recursive: true, force: true }))
  const faux = fauxProvider({ provider: 'steer-provider', models: [{ id: 'steer-model' }] })
  const modelRuntime = await ModelRuntime.create({
    credentials: new InMemoryCredentialStore(),
    refreshOnCreate: false,
  })
  modelRuntime.registerNativeProvider(faux.provider)
  await modelRuntime.setRuntimeApiKey(faux.provider.id, 'steer-key')
  const settingsManager = SettingsManager.inMemory({ retry: { enabled: false } })
  const resourceLoader = new DefaultResourceLoader({
    cwd: directory,
    agentDir: directory,
    settingsManager,
    extensionFactories,
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
  return session
}

function queuedText(session: Awaited<ReturnType<typeof createSession>>) {
  return session.agent
    .peekQueuedMessages()
    .map((message) =>
      message.role === 'user' && Array.isArray(message.content)
        ? message.content.map((block) => (block.type === 'text' ? block.text : '')).join('')
        : '',
    )
}

describe('patched Pi steer contract', () => {
  it('resolves to the exact transformed text it queued when given a transform', async () => {
    const session = await createSession()

    const durableText = await session.steer(
      'Use the safer path',
      undefined,
      (text) => `[ctx] ${text}`,
    )

    expect(durableText).toBe('[ctx] Use the safer path')
    expect(queuedText(session)).toEqual(['[ctx] Use the safer path'])
  })

  it("keeps Pi's disposition contract for the options form", async () => {
    const session = await createSession()

    await expect(session.steer('Use the safer path', undefined, { source: 'rpc' })).resolves.toBe(
      'queued',
    )
    expect(queuedText(session)).toEqual(['Use the safer path'])
  })

  it('resolves to undefined when an input handler consumes the steering text', async () => {
    const consumeInput: ExtensionFactory = (pi) => {
      pi.on('input', () => ({ action: 'handled' }))
    }
    const session = await createSession([consumeInput])

    await expect(session.steer('/stop', undefined, (text) => text)).resolves.toBeUndefined()
    await expect(session.steer('/stop')).resolves.toBe('handled')
    expect(queuedText(session)).toEqual([])
  })
})
