import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fauxAssistantMessage } from '@earendil-works/pi-ai'
import type { ExtensionFactory } from '@earendil-works/pi-coding-agent'
import { SessionManager } from '@earendil-works/pi-coding-agent'
import { fromPartial } from '@total-typescript/shoehorn'
import { describe, expect, it, vi } from 'vitest'
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

  it('emits input before executing a registered extension command', async () => {
    const projectPath = await createTempProject()
    const events: string[] = []
    const factory: ExtensionFactory = (pi) => {
      pi.on('input', () => {
        events.push('input')
        return { action: 'continue' }
      })
      pi.registerCommand('registered-command', {
        description: 'Ordering probe',
        handler: async () => {
          events.push('command')
        },
      })
    }
    const services = await createPiRuntimeServices(projectPath, {
      extensionFactories: [factory],
    })
    const { session } = await createOpenWaggleAgentSessionFromServices({
      services,
      sessionManager: SessionManager.inMemory(projectPath),
    })

    await session.prompt('/registered-command')

    expect(events).toEqual(['input', 'command'])
    await disposeOpenWagglePiSession(session)
  })

  it('re-reads steering queues after post-run compaction checks', async () => {
    const projectPath = await createTempProject()
    const services = await createPiRuntimeServices(projectPath)
    const { session } = await createOpenWaggleAgentSessionFromServices({
      services,
      sessionManager: SessionManager.inMemory(projectPath),
    })
    const checkStarted = Promise.withResolvers<void>()
    const finishCheck = Promise.withResolvers<void>()
    let hasQueuedMessages = false
    const internals = fromPartial<{
      _lastAssistantMessage: ReturnType<typeof fauxAssistantMessage> | undefined
      _checkCompaction: () => Promise<boolean>
      _handlePostAgentRun: () => Promise<boolean>
      agent: { hasQueuedMessages: () => boolean }
    }>(session)
    internals._lastAssistantMessage = fauxAssistantMessage('Turn complete')
    internals.agent.hasQueuedMessages = vi.fn(() => hasQueuedMessages)
    internals._checkCompaction = vi.fn(async () => {
      checkStarted.resolve()
      await finishCheck.promise
      return false
    })

    const handling = internals._handlePostAgentRun()
    await checkStarted.promise
    hasQueuedMessages = true
    finishCheck.resolve()

    await expect(handling).resolves.toBe(true)
    await disposeOpenWagglePiSession(session)
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
