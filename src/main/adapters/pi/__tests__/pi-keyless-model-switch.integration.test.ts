import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fauxProvider, InMemoryCredentialStore } from '@earendil-works/pi-ai'
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from '@earendil-works/pi-coding-agent'
import { afterEach, describe, expect, it, vi } from 'vitest'

const cleanups: Array<() => void> = []

afterEach(() => {
  vi.unstubAllEnvs()
  while (cleanups.length > 0) cleanups.pop()?.()
})

/** A session on a faux model, with Amazon Bedrock signed in through an AWS profile only. */
async function createSession() {
  for (const name of [
    'AWS_BEARER_TOKEN_BEDROCK',
    'AWS_ACCESS_KEY_ID',
    'AWS_SECRET_ACCESS_KEY',
    'AWS_CONTAINER_CREDENTIALS_RELATIVE_URI',
    'AWS_CONTAINER_CREDENTIALS_FULL_URI',
    'AWS_WEB_IDENTITY_TOKEN_FILE',
  ]) {
    vi.stubEnv(name, undefined)
  }
  vi.stubEnv('AWS_PROFILE', 'openwaggle-keyless-test')
  const directory = mkdtempSync(path.join(tmpdir(), 'openwaggle-pi-keyless-switch-'))
  cleanups.push(() => rmSync(directory, { recursive: true, force: true }))
  const faux = fauxProvider({ provider: 'keyed-provider', models: [{ id: 'keyed-model' }] })
  const modelRuntime = await ModelRuntime.create({
    credentials: new InMemoryCredentialStore(),
    refreshOnCreate: false,
  })
  modelRuntime.registerNativeProvider(faux.provider)
  await modelRuntime.setRuntimeApiKey(faux.provider.id, 'keyed-key')
  const settingsManager = SettingsManager.inMemory({ retry: { enabled: false } })
  const resourceLoader = new DefaultResourceLoader({
    cwd: directory,
    agentDir: directory,
    settingsManager,
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
  cleanups.push(() => session.dispose())
  const bedrock = modelRuntime.getModels('amazon-bedrock')[0]
  if (!bedrock) throw new Error('Pi has no Amazon Bedrock model')
  return { session, bedrock }
}

describe('model switch to a provider whose auth needs no API key', () => {
  it('switches to Amazon Bedrock signed in through an AWS profile', async () => {
    const { session, bedrock } = await createSession()

    await session.setModel(bedrock)

    expect(session.model).toMatchObject({ provider: 'amazon-bedrock', id: bedrock.id })
  })

  it('still refuses a provider with no configured auth', async () => {
    const { session, bedrock } = await createSession()
    vi.stubEnv('AWS_PROFILE', undefined)

    await expect(session.setModel(bedrock)).rejects.toThrow()
  })
})
