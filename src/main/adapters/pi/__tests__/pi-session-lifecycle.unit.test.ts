import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { ExtensionFactory } from '@earendil-works/pi-coding-agent'
import { SessionManager } from '@earendil-works/pi-coding-agent'
import { describe, expect, it } from 'vitest'
import { createPiRuntimeServices } from '../pi-provider-catalog'
import {
  createOpenWaggleAgentSessionFromServices,
  disposeOpenWagglePiSession,
  withOpenWagglePiSessionLifecycleContext,
} from '../pi-session-lifecycle'

async function createTempProject() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-pi-session-lifecycle-'))
}

describe('Pi session lifecycle', () => {
  it('binds session_start and emits session_shutdown on dispose', async () => {
    const projectPath = await createTempProject()
    const events: {
      starts: number
      shutdowns: number
    } = {
      starts: 0,
      shutdowns: 0,
    }
    const factory: ExtensionFactory = (pi) => {
      pi.on('session_start', () => {
        events.starts += 1
      })
      pi.on('session_shutdown', () => {
        events.shutdowns += 1
      })
    }

    const services = await createPiRuntimeServices(projectPath, {
      extensionFactories: [factory],
    })
    const { session } = await createOpenWaggleAgentSessionFromServices({
      services,
      sessionManager: SessionManager.inMemory(projectPath),
    })

    expect(events.starts).toBe(1)

    await disposeOpenWagglePiSession(session)
    expect(events.shutdowns).toBe(1)
  })

  it('does not let shutdown hook failures escape disposal', async () => {
    const projectPath = await createTempProject()
    const factory: ExtensionFactory = (pi) => {
      pi.on('session_shutdown', () => {
        throw new Error('shutdown failed')
      })
    }
    const services = await createPiRuntimeServices(projectPath, {
      extensionFactories: [factory],
    })
    const { session } = await createOpenWaggleAgentSessionFromServices({
      services,
      sessionManager: SessionManager.inMemory(projectPath),
    })

    await expect(disposeOpenWagglePiSession(session)).resolves.toBeUndefined()
  })

  it('executes raw lifecycle operations without process-global mutation', async () => {
    const projectPath = await createTempProject()
    const services = await createPiRuntimeServices(projectPath)
    const { session } = await createOpenWaggleAgentSessionFromServices({
      services,
      sessionManager: SessionManager.inMemory(projectPath),
    })

    const result = await withOpenWagglePiSessionLifecycleContext(session, async () =>
      Promise.resolve({ cwd: process.cwd(), argv: [...process.argv] }),
    )

    expect(result).toEqual({ cwd: process.cwd(), argv: [...process.argv] })

    await disposeOpenWagglePiSession(session)
  })
})
