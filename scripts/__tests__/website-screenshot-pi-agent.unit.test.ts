import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { writeFixturePiAgent } from '../website-screenshot-pi-agent'

const LOOPBACK = 'http://127.0.0.1:'
const FIXTURE_MODEL = {
  openAiBaseUrl: 'http://127.0.0.1:4100/v1',
  anthropicBaseUrl: 'http://127.0.0.1:4100',
}

describe('the screenshot Pi agent directory', () => {
  let scratch = ''

  beforeEach(async () => {
    scratch = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-shots-pi-')))
  })

  afterEach(async () => {
    await fs.rm(scratch, { recursive: true, force: true })
  })

  it('sends every OpenAI and Anthropic model a fixture key can use to the loopback server', async () => {
    const homeDir = path.join(scratch, 'home')
    await writeFixturePiAgent({ userDataDir: path.join(scratch, 'user-data'), homeDir, model: FIXTURE_MODEL })
    const agentDir = path.join(homeDir, '.pi', 'agent')
    // Pi's own loader, so the test fails if Pi stops applying a provider-level baseUrl to its catalog.
    const { ModelRuntime } = await import('@earendil-works/pi-coding-agent')
    const runtime = await ModelRuntime.create({
      authPath: path.join(agentDir, 'auth.json'),
      modelsPath: path.join(agentDir, 'models.json'),
      modelsStorePath: path.join(scratch, 'models-store.json'),
      refreshOnCreate: false,
    })
    expect(runtime.getError()).toBeUndefined()

    const offProvider: string[] = []
    for (const provider of ['openai', 'anthropic']) {
      const models = runtime.getModels(provider)
      expect(models.length).toBeGreaterThan(1)
      for (const model of models) {
        const { model: prepared, resolution } = await runtime.prepareModelRequest(model)
        if (!model.baseUrl.startsWith(LOOPBACK) || !prepared.baseUrl.startsWith(LOOPBACK)) {
          offProvider.push(`${provider}/${model.id} ${prepared.baseUrl}`)
        }
        expect(resolution).toMatchObject({ auth: { apiKey: expect.stringContaining('website-fixture') } })
      }
    }
    expect(offProvider).toEqual([])
    expect(runtime.getModel('openai', 'gpt-5.4')).toMatchObject({
      api: 'openai-completions',
      baseUrl: FIXTURE_MODEL.openAiBaseUrl,
    })
  })
})
