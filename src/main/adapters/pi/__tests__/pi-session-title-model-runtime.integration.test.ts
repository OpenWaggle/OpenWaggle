import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { AgentSession } from '@earendil-works/pi-coding-agent'
import * as Effect from 'effect/Effect'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { projectTitleModelRuntime } from '../pi-session-title-generator'
import { writeProviderExtension } from './pi-provider-catalog.test-utils'

const NO_OPENWAGGLE_EXTENSIONS = {
  manager: { listPackages: () => Effect.succeed([]) },
  lifecycleRepository: {
    get: () => Effect.succeed(null),
    list: () => Effect.succeed([]),
    upsert: () => Effect.void,
  },
  projectOverridesRepository: { get: () => Effect.succeed(null), upsert: () => Effect.void },
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('the Title model registry', () => {
  it("has the models the Session's project extensions register, as Runs do", async () => {
    vi.stubEnv('PI_CODING_AGENT_DIR', await fs.mkdtemp(path.join(os.tmpdir(), 'ow-pi-agent-')))
    const projectPath = await fs.mkdtemp(path.join(os.tmpdir(), 'ow-title-model-'))
    await writeProviderExtension(projectPath, 'qa-router')

    const { modelRuntime: runtime, release } =
      await projectTitleModelRuntime(NO_OPENWAGGLE_EXTENSIONS)(projectPath)
    release()

    expect(runtime.getModel('qa-router', 'offline-model')).toMatchObject({
      provider: 'qa-router',
      id: 'offline-model',
    })
  })

  it('disposes the session that binds the extensions once the request releases it', async () => {
    vi.stubEnv('PI_CODING_AGENT_DIR', await fs.mkdtemp(path.join(os.tmpdir(), 'ow-pi-agent-')))
    const projectPath = await fs.mkdtemp(path.join(os.tmpdir(), 'ow-title-model-'))
    await writeProviderExtension(projectPath, 'qa-router')
    const dispose = vi.spyOn(AgentSession.prototype, 'dispose')

    const { release } = await projectTitleModelRuntime(NO_OPENWAGGLE_EXTENSIONS)(projectPath)
    expect(dispose).not.toHaveBeenCalled()
    release()

    expect(dispose).toHaveBeenCalledOnce()
  })
})
