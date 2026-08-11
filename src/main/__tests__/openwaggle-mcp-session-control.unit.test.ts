import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { MCP_CONFIG } from '@shared/constants/mcp'
import { SessionId } from '@shared/types/brand'
import type { SessionDetail } from '@shared/types/session'
import type { ThinkingLevel } from '@shared/types/settings'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OpenWaggleMcpServeOptions } from '../openwaggle-mcp-server-policy'
import {
  OpenWaggleMcpSessionMetadataStore,
  sessionMetadataStorePath,
} from '../openwaggle-mcp-session-metadata-store'
import {
  executeSessionOperation,
  type OpenWaggleSessionTaskController,
  sessionInputSchema,
} from '../openwaggle-mcp-session-tool'
import {
  OpenWaggleServerTaskManager,
  type OpenWaggleServerTaskServices,
} from '../openwaggle-mcp-task-manager'

vi.mock('electron', () => ({
  app: { getPath: () => tmpdir() },
}))

const SESSION_ID = SessionId('session-target')
let temporaryRoot = ''

function serveOptions(
  overrides: Partial<Pick<OpenWaggleMcpServeOptions, 'grants' | 'originSessionId'>> = {},
): OpenWaggleMcpServeOptions {
  return {
    transport: 'stdio',
    grants: new Set([
      'sessions:discover',
      'sessions:read',
      'sessions:create',
      'sessions:message',
      'sessions:interrupt',
      'sessions:organize',
    ]),
    workspaceRoots: [],
    sessionIds: new Set(),
    profile: 'test-profile',
    taskStorePath: path.join(temporaryRoot, 'tasks.json'),
    version: '0.0.0-test',
    ...overrides,
  }
}

function session(overrides: Partial<SessionDetail> = {}): SessionDetail {
  return {
    id: SESSION_ID,
    title: 'Target session',
    projectPath: temporaryRoot,
    messages: [],
    createdAt: 1,
    updatedAt: 2,
    ...overrides,
  }
}

function sessionTasks(): OpenWaggleSessionTaskController {
  return {
    start: vi.fn(async () => ({ status: 'queued' })),
    listForSession: vi.fn(async () => []),
    hasActiveSessionTask: vi.fn(() => false),
    getExecutionProfile: vi.fn(async () => ({
      model: 'provider/model',
      thinkingLevel: 'medium' satisfies ThinkingLevel,
    })),
    cancelSession: vi.fn(async () => 0),
    waitForSession: vi.fn(async () => true),
  }
}

function sessionAdapters() {
  return {
    materializeWorktree: vi.fn(async () => temporaryRoot),
    loadSession: vi.fn(async () => session()),
  }
}

beforeEach(async () => {
  temporaryRoot = await mkdtemp(path.join(tmpdir(), 'openwaggle-session-control-'))
})

afterEach(async () => {
  await rm(temporaryRoot, { recursive: true, force: true })
})

describe('hosted MCP session control', () => {
  it('publishes the complete external session operation schema', () => {
    const operations = [
      'list',
      'status',
      'read',
      'create',
      'plan-worktree',
      'create-worktree',
      'fork',
      'clone',
      'message',
      'steer',
      'wait',
      'interrupt',
      'handoff',
      'rename',
      'pin',
      'unpin',
      'archive',
      'unarchive',
    ]

    for (const operation of operations) {
      expect(sessionInputSchema.safeParse({ operation }).success).toBe(true)
    }
  })

  it('persists pin and transparent handoff metadata and returns it from status', async () => {
    const options = serveOptions()
    const metadataPath = sessionMetadataStorePath(options.taskStorePath)
    const metadata = new OpenWaggleMcpSessionMetadataStore(metadataPath)
    const tasks = sessionTasks()
    const adapters = sessionAdapters()

    await executeSessionOperation(options, tasks, metadata, adapters, {
      operation: 'pin',
      sessionId: SESSION_ID,
    })
    await executeSessionOperation(options, tasks, metadata, adapters, {
      operation: 'handoff',
      sessionId: SESSION_ID,
      handoffSummary: 'Continue from the verified migration checkpoint.',
    })
    const status = await executeSessionOperation(options, tasks, metadata, adapters, {
      operation: 'status',
      sessionId: SESSION_ID,
    })

    expect(status.structuredContent).toMatchObject({
      pinned: true,
      handoff: {
        summary: 'Continue from the verified migration checkpoint.',
        createdByProfile: 'test-profile',
      },
    })
    expect(await new OpenWaggleMcpSessionMetadataStore(metadataPath).get(SESSION_ID)).toMatchObject(
      {
        pinned: true,
        handoff: { summary: 'Continue from the verified migration checkpoint.' },
      },
    )
  })

  it('enforces operation grants and immutable origin-session self-targeting', async () => {
    const metadata = new OpenWaggleMcpSessionMetadataStore(
      sessionMetadataStorePath(path.join(temporaryRoot, 'tasks.json')),
    )
    const tasks = sessionTasks()
    const adapters = sessionAdapters()

    await expect(
      executeSessionOperation(serveOptions({ grants: new Set() }), tasks, metadata, adapters, {
        operation: 'interrupt',
        sessionId: SESSION_ID,
      }),
    ).rejects.toThrow('lacks sessions:interrupt')
    await expect(
      executeSessionOperation(
        serveOptions({ originSessionId: SESSION_ID }),
        tasks,
        metadata,
        adapters,
        { operation: 'message', sessionId: SESSION_ID, objective: 'keep going' },
      ),
    ).rejects.toThrow('cannot target its own origin session')
    expect(tasks.start).not.toHaveBeenCalled()
  })

  it('forks with the target-owned model, persists derived depth, and materializes worktrees', async () => {
    const options = serveOptions()
    const metadata = new OpenWaggleMcpSessionMetadataStore(
      sessionMetadataStorePath(options.taskStorePath),
    )
    const tasks = sessionTasks()
    const copiedSession = session({ id: SessionId('session-copy'), title: 'Copied session' })
    const copySession = vi.fn(async () => ({ cancelled: false, session: copiedSession }))
    const materializeWorktree = vi.fn(async () => path.join(temporaryRoot, 'worktree'))
    const adapters = {
      loadSession: vi.fn(async () => session({ environmentMode: 'worktree' })),
      reloadSession: vi.fn(async () => session({ environmentMode: 'worktree' })),
      copySession,
      materializeWorktree,
    }

    const forked = await executeSessionOperation(options, tasks, metadata, adapters, {
      operation: 'fork',
      sessionId: SESSION_ID,
      targetNodeId: 'target-node',
    })
    const worktree = await executeSessionOperation(options, tasks, metadata, adapters, {
      operation: 'create-worktree',
      sessionId: SESSION_ID,
    })

    expect(copySession).toHaveBeenCalledWith({
      operation: 'fork',
      sessionId: SESSION_ID,
      targetNodeId: 'target-node',
      model: 'provider/model',
    })
    expect(forked.structuredContent).toMatchObject({ delegationDepth: 1 })
    expect(await metadata.depth(copiedSession.id)).toBe(1)
    expect(materializeWorktree).toHaveBeenCalledWith(
      expect.objectContaining({ id: SESSION_ID, environmentMode: 'worktree' }),
    )
    expect(worktree.structuredContent).toMatchObject({
      worktreePath: path.join(temporaryRoot, 'worktree'),
      completed: true,
    })
  })
})

describe('hosted MCP session task limits', () => {
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

  it('uses the target-owned execution profile and rejects self-targeting', async () => {
    const options = serveOptions({ originSessionId: 'origin' })
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
    const options = serveOptions({ originSessionId: 'origin' })
    const metadata = new OpenWaggleMcpSessionMetadataStore(
      sessionMetadataStorePath(options.taskStorePath),
    )
    await metadata.setDepth('origin', MCP_CONFIG.MAX_ORCHESTRATION_DEPTH)
    const manager = new OpenWaggleServerTaskManager(options, metadata, services())

    await expect(
      manager.start({ projectPath: temporaryRoot, objective: 'too deep' }),
    ).rejects.toThrow('maximum hosted session depth')

    const rootOptions = serveOptions()
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
