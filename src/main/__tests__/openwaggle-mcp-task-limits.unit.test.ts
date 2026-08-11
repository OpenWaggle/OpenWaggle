import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { MCP_CONFIG } from '@shared/constants/mcp'
import { SessionId } from '@shared/types/brand'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  OpenWaggleMcpSessionMetadataStore,
  sessionMetadataStorePath,
} from '../openwaggle-mcp-session-metadata-store'
import {
  OpenWaggleServerTaskManager,
  type OpenWaggleServerTaskServices,
} from '../openwaggle-mcp-task-manager'
import { SESSION_ID, serveOptions } from './openwaggle-mcp-session-control.test-support'

vi.mock('electron', () => ({ app: { getPath: () => tmpdir() } }))

let temporaryRoot = ''

beforeEach(async () => {
  temporaryRoot = await mkdtemp(path.join(tmpdir(), 'openwaggle-task-limits-'))
})

afterEach(async () => {
  await rm(temporaryRoot, { recursive: true, force: true })
})

function services(): OpenWaggleServerTaskServices {
  return {
    resolveExecutionProfile: vi.fn(async () => ({
      model: 'target-provider/target-model',
      thinkingLevel: 'medium' as const,
    })),
    createOrReuseSession: vi.fn(async (task) => ({
      sessionId: SessionId(task.sessionId ?? `created-${task.id}`),
      created: !task.sessionId,
    })),
    execute: vi.fn(async ({ signal }) => {
      if (signal.aborted) return { outcome: 'aborted' as const }
      return new Promise<{ readonly outcome: 'aborted' }>((resolve) => {
        signal.addEventListener('abort', () => resolve({ outcome: 'aborted' }), { once: true })
      })
    }),
  }
}

describe('hosted MCP session task limits', () => {
  it('uses the target-owned execution profile and rejects self-targeting', async () => {
    const options = serveOptions(temporaryRoot, { originSessionId: 'origin' })
    const metadata = new OpenWaggleMcpSessionMetadataStore(
      sessionMetadataStorePath(options.taskStorePath),
    )
    const taskServices = services()
    const manager = new OpenWaggleServerTaskManager(options, metadata, taskServices)

    const task = await manager.start({
      projectPath: temporaryRoot,
      sessionId: SESSION_ID,
      objective: 'Inspect the target.',
    })

    expect(task).toMatchObject({ model: 'target-provider/target-model', sessionId: SESSION_ID })
    expect(taskServices.resolveExecutionProfile).toHaveBeenCalledWith(SESSION_ID)
    await expect(
      manager.start({ projectPath: temporaryRoot, sessionId: 'origin', objective: 'self' }),
    ).rejects.toThrow('cannot target its own origin session')
    await manager.cancelAll()
    await manager.waitForSession(SESSION_ID, 1_000)
    await expect(manager.get(task.id)).resolves.toMatchObject({ status: 'cancelled' })
  })

  it('hard-caps derived depth and active fan-out', async () => {
    const options = serveOptions(temporaryRoot, { originSessionId: 'origin' })
    const metadata = new OpenWaggleMcpSessionMetadataStore(
      sessionMetadataStorePath(options.taskStorePath),
    )
    await metadata.setDepth('origin', MCP_CONFIG.MAX_ORCHESTRATION_DEPTH)
    const manager = new OpenWaggleServerTaskManager(options, metadata, services())
    await expect(
      manager.start({ projectPath: temporaryRoot, objective: 'too deep' }),
    ).rejects.toThrow('maximum hosted session depth')

    const targetOptions = serveOptions(temporaryRoot)
    const targetMetadata = new OpenWaggleMcpSessionMetadataStore(
      sessionMetadataStorePath(path.join(temporaryRoot, 'target-depth-tasks.json')),
    )
    await targetMetadata.setDepth(SESSION_ID, MCP_CONFIG.MAX_ORCHESTRATION_DEPTH)
    const targetManager = new OpenWaggleServerTaskManager(targetOptions, targetMetadata, services())
    await expect(
      targetManager.start({
        projectPath: temporaryRoot,
        sessionId: SESSION_ID,
        objective: 'target chain too deep',
      }),
    ).rejects.toThrow('maximum hosted session depth')

    const rootOptions = serveOptions(temporaryRoot)
    const rootMetadata = new OpenWaggleMcpSessionMetadataStore(
      sessionMetadataStorePath(rootOptions.taskStorePath),
    )
    const rootManager = new OpenWaggleServerTaskManager(rootOptions, rootMetadata, services())
    for (let index = 0; index < MCP_CONFIG.MAX_SESSION_FAN_OUT; index += 1) {
      await rootManager.start({ projectPath: temporaryRoot, objective: `task ${index}` })
    }
    await expect(
      rootManager.start({ projectPath: temporaryRoot, objective: 'one too many' }),
    ).rejects.toThrow(`${MCP_CONFIG.MAX_SESSION_FAN_OUT} active session tasks`)
    await rootManager.cancelAll()
  })
})
