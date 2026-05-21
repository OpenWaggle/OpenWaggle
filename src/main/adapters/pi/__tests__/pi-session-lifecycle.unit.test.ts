import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { ExtensionFactory } from '@mariozechner/pi-coding-agent'
import { SessionManager } from '@mariozechner/pi-coding-agent'
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
  it('binds session_start with the MCP adapter runtime context and emits session_shutdown on dispose', async () => {
    const projectPath = await createTempProject()
    const adapterCwd = path.join(projectPath, 'generated-adapter-cwd')
    const configPath = path.join(projectPath, 'generated-mcp.json')
    await fs.mkdir(adapterCwd, { recursive: true })
    await fs.writeFile(configPath, '{"mcpServers":{}}\n', 'utf8')

    const events: {
      readonly sessionStartCwds: string[]
      readonly sessionStartConfigs: string[]
      readonly sessionShutdownCwds: string[]
      readonly sessionShutdownConfigs: string[]
      shutdowns: number
    } = {
      sessionStartCwds: [],
      sessionStartConfigs: [],
      sessionShutdownCwds: [],
      sessionShutdownConfigs: [],
      shutdowns: 0,
    }
    const factory: ExtensionFactory = (pi) => {
      pi.registerFlag('mcp-config', {
        description: 'Path to MCP config file',
        type: 'string',
      })
      pi.on('session_start', () => {
        events.sessionStartCwds.push(process.cwd())
        const config = pi.getFlag('mcp-config')
        if (typeof config === 'string') {
          events.sessionStartConfigs.push(config)
        }
      })
      pi.on('session_shutdown', () => {
        events.sessionShutdownCwds.push(process.cwd())
        const config = pi.getFlag('mcp-config')
        if (typeof config === 'string') {
          events.sessionShutdownConfigs.push(config)
        }
        events.shutdowns += 1
      })
    }

    const services = await createPiRuntimeServices(projectPath, {
      extensionFactories: [factory],
      mcpRuntimeContext: { configPath, adapterCwd },
    })
    const { session } = await createOpenWaggleAgentSessionFromServices({
      services,
      sessionManager: SessionManager.inMemory(projectPath),
    })

    expect(events.sessionStartCwds).toEqual([adapterCwd])
    expect(events.sessionStartConfigs).toEqual([configPath])

    await disposeOpenWagglePiSession(session)
    expect(events.shutdowns).toBe(1)
    expect(events.sessionShutdownCwds).toEqual([adapterCwd])
    expect(events.sessionShutdownConfigs).toEqual([configPath])
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
      mcpRuntimeContext: null,
    })
    const { session } = await createOpenWaggleAgentSessionFromServices({
      services,
      sessionManager: SessionManager.inMemory(projectPath),
    })

    await expect(disposeOpenWagglePiSession(session)).resolves.toBeUndefined()
  })

  it('scopes raw lifecycle operations to the MCP adapter runtime context', async () => {
    const projectPath = await createTempProject()
    const adapterCwd = path.join(projectPath, 'generated-adapter-cwd')
    const configPath = path.join(projectPath, 'generated-mcp.json')
    await fs.mkdir(adapterCwd, { recursive: true })
    await fs.writeFile(configPath, '{"mcpServers":{}}\n', 'utf8')

    const shutdownCwds: string[] = []
    const shutdownConfigs: string[] = []
    const factory: ExtensionFactory = (pi) => {
      pi.registerFlag('mcp-config', {
        description: 'Path to MCP config file',
        type: 'string',
      })
      pi.on('session_shutdown', () => {
        shutdownCwds.push(process.cwd())
        const config = pi.getFlag('mcp-config')
        if (typeof config === 'string') {
          shutdownConfigs.push(config)
        }
      })
    }

    const services = await createPiRuntimeServices(projectPath, {
      extensionFactories: [factory],
      mcpRuntimeContext: { configPath, adapterCwd },
    })
    const { session } = await createOpenWaggleAgentSessionFromServices({
      services,
      sessionManager: SessionManager.inMemory(projectPath),
    })

    await withOpenWagglePiSessionLifecycleContext(session, () =>
      session.extensionRunner.emit({ type: 'session_shutdown', reason: 'quit' }),
    )

    expect(shutdownCwds).toEqual([adapterCwd])
    expect(shutdownConfigs).toEqual([configPath])

    await disposeOpenWagglePiSession(session)
  })
})
