import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { MCP_CONFIG } from '@shared/constants/mcp'
import { SessionId } from '@shared/types/brand'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OpenWaggleMcpServeOptions } from '../openwaggle-mcp-server-policy'
import {
  OpenWaggleMcpSessionMetadataStore,
  sessionMetadataStorePath,
} from '../openwaggle-mcp-session-metadata-store'
import {
  OpenWaggleServerTaskManager,
  type OpenWaggleServerTaskServices,
} from '../openwaggle-mcp-task-manager'
import { OpenWaggleMcpTaskStore, type ServerTaskRecord } from '../openwaggle-mcp-task-store'

vi.mock('electron', () => ({
  app: { getPath: () => tmpdir() },
}))

let temporaryRoot = ''

beforeEach(async () => {
  temporaryRoot = await mkdtemp(path.join(tmpdir(), 'openwaggle-mcp-task-concurrency-'))
})

afterEach(async () => {
  await rm(temporaryRoot, { recursive: true, force: true })
})

function serveOptions(profile = 'lease-test'): OpenWaggleMcpServeOptions {
  return {
    transport: 'stdio',
    grants: new Set(),
    workspaceRoots: [],
    sessionIds: new Set(),
    profile,
    taskStorePath: path.join(temporaryRoot, 'tasks.json'),
    version: 'test',
  }
}

function metadata(options: OpenWaggleMcpServeOptions) {
  return new OpenWaggleMcpSessionMetadataStore(sessionMetadataStorePath(options.taskStorePath))
}

function hangingServices(): OpenWaggleServerTaskServices {
  return {
    resolveExecutionProfile: vi.fn(async () => ({
      model: 'provider/model',
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

async function waitForTaskStatus(
  manager: OpenWaggleServerTaskManager,
  taskId: string,
  status: string,
) {
  const deadline = Date.now() + 2_000
  while (Date.now() < deadline) {
    const task = await manager.get(taskId)
    if (task.status === status) return task
    await new Promise<void>((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`Task ${taskId} did not reach ${status}.`)
}

describe('hosted MCP task cross-process integrity', () => {
  it('recovers only expired leases owned by the same caller profile', async () => {
    let now = 1_000
    const options = serveOptions()
    const owner = new OpenWaggleServerTaskManager(options, metadata(options), hangingServices(), {
      ownerId: 'owner-a',
      now: () => now,
      leaseDurationMs: 100,
      heartbeatIntervalMs: 60_000,
    })
    const task = await owner.start({ projectPath: temporaryRoot, objective: 'keep running' })

    const sameProfile = new OpenWaggleServerTaskManager(
      options,
      metadata(options),
      hangingServices(),
      { ownerId: 'owner-b', now: () => now },
    )
    await sameProfile.recoverInterruptedTasks()
    await expect(sameProfile.get(task.id)).resolves.not.toMatchObject({ status: 'interrupted' })

    now = 1_101
    const otherOptions = serveOptions('other-profile')
    const otherProfile = new OpenWaggleServerTaskManager(
      otherOptions,
      metadata(otherOptions),
      hangingServices(),
      { ownerId: 'owner-c', now: () => now },
    )
    await otherProfile.recoverInterruptedTasks()
    const storedBeforeOwnerRecovery = await new OpenWaggleMcpTaskStore(
      options.taskStorePath,
    ).readTasks()
    expect(
      storedBeforeOwnerRecovery.find((candidate) => candidate.id === task.id)?.status,
    ).not.toBe('interrupted')

    await sameProfile.recoverInterruptedTasks()
    await expect(sameProfile.get(task.id)).resolves.toMatchObject({
      status: 'interrupted',
      action: expect.stringContaining('lease expired'),
    })
    await owner.cancelAll()
  })

  it('enforces fan-out atomically across multiple servers sharing a profile', async () => {
    const options = serveOptions()
    const first = new OpenWaggleServerTaskManager(options, metadata(options), hangingServices())
    const second = new OpenWaggleServerTaskManager(options, metadata(options), hangingServices())

    for (let index = 0; index < MCP_CONFIG.MAX_SESSION_FAN_OUT; index += 1) {
      const manager = index % 2 === 0 ? first : second
      await manager.start({ projectPath: temporaryRoot, objective: `task ${index}` })
    }
    await expect(
      second.start({ projectPath: temporaryRoot, objective: 'one too many' }),
    ).rejects.toThrow(`${MCP_CONFIG.MAX_SESSION_FAN_OUT} active session tasks`)

    await Promise.all([first.cancelAll(), second.cancelAll()])
  })

  it('renews a live owner lease before another server performs recovery', async () => {
    let now = 1_000
    const options = serveOptions()
    const owner = new OpenWaggleServerTaskManager(options, metadata(options), hangingServices(), {
      ownerId: 'owner-a',
      now: () => now,
      leaseDurationMs: 100,
      heartbeatIntervalMs: 10,
    })
    const task = await owner.start({ projectPath: temporaryRoot, objective: 'renew me' })
    now = 1_090
    await new Promise<void>((resolve) => setTimeout(resolve, 30))
    now = 1_101

    const recovery = new OpenWaggleServerTaskManager(
      options,
      metadata(options),
      hangingServices(),
      { ownerId: 'owner-b', now: () => now },
    )
    await recovery.recoverInterruptedTasks()
    await expect(recovery.get(task.id)).resolves.not.toMatchObject({ status: 'interrupted' })
    await owner.cancelAll()
  })

  it('finalizes an unacknowledged cancellation after its owner lease expires', async () => {
    const options = serveOptions()
    const store = new OpenWaggleMcpTaskStore(options.taskStorePath)
    const expired: ServerTaskRecord = {
      id: 'expired-cancellation',
      callerProfile: options.profile,
      projectPath: temporaryRoot,
      model: 'provider/model',
      objective: 'cancel me',
      status: 'working',
      lease: { ownerId: 'stopped-owner', expiresAt: 100 },
      cancellationRequestedAt: 90,
      createdAt: 1,
      updatedAt: 90,
    }
    await store.update(() => ({ tasks: [expired], result: true }))
    const recovery = new OpenWaggleServerTaskManager(
      options,
      metadata(options),
      hangingServices(),
      { now: () => 101 },
    )

    await recovery.recoverInterruptedTasks()

    await expect(recovery.get(expired.id)).resolves.toMatchObject({
      status: 'cancelled',
      cancellationRequestedAt: 90,
      action: expect.stringContaining('No further action'),
    })
  })

  it('delivers a durable cancellation request to the owning server', async () => {
    const options = serveOptions()
    const owner = new OpenWaggleServerTaskManager(options, metadata(options), hangingServices(), {
      ownerId: 'owner-a',
      leaseDurationMs: 1_000,
      heartbeatIntervalMs: 10,
    })
    const remote = new OpenWaggleServerTaskManager(options, metadata(options), hangingServices(), {
      ownerId: 'owner-b',
    })
    const task = await owner.start({
      projectPath: temporaryRoot,
      sessionId: 'shared-session',
      objective: 'cancel remotely',
    })

    await expect(remote.waitForSession('shared-session', 0)).resolves.toBe(false)
    await expect(remote.cancel(task.id)).resolves.toMatchObject({
      cancellationRequestedAt: expect.any(Number),
      action: expect.stringContaining('owning MCP server'),
    })
    await expect(waitForTaskStatus(remote, task.id, 'cancelled')).resolves.toMatchObject({
      status: 'cancelled',
    })
    await expect(remote.waitForSession('shared-session', 100)).resolves.toBe(true)
    await owner.cancelAll()
  })

  it('serializes independent task-store writers without losing records', async () => {
    const options = serveOptions()
    const first = new OpenWaggleMcpTaskStore(options.taskStorePath)
    const second = new OpenWaggleMcpTaskStore(options.taskStorePath)
    const record = (id: string): ServerTaskRecord => ({
      id,
      callerProfile: options.profile,
      projectPath: temporaryRoot,
      model: 'provider/model',
      objective: id,
      status: 'completed',
      createdAt: 1,
      updatedAt: 1,
    })

    await Promise.all([
      first.update((tasks) => ({ tasks: [record('first'), ...tasks], result: true })),
      second.update((tasks) => ({ tasks: [record('second'), ...tasks], result: true })),
    ])

    await expect(first.readTasks()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'first' }),
        expect.objectContaining({ id: 'second' }),
      ]),
    )
  })

  it('retains every nonterminal record while capping terminal history', async () => {
    const options = serveOptions()
    const store = new OpenWaggleMcpTaskStore(options.taskStorePath)
    const terminal: ServerTaskRecord[] = Array.from({ length: 1_005 }, (_, index) => ({
      id: `terminal-${index}`,
      callerProfile: options.profile,
      projectPath: temporaryRoot,
      model: 'provider/model',
      objective: 'done',
      status: 'completed',
      createdAt: index,
      updatedAt: index,
    }))
    const active: ServerTaskRecord = {
      id: 'long-running',
      callerProfile: options.profile,
      projectPath: temporaryRoot,
      model: 'provider/model',
      objective: 'still running',
      status: 'working',
      lease: { ownerId: 'owner', expiresAt: Date.now() + 60_000 },
      createdAt: 0,
      updatedAt: 0,
    }
    const leaseLiveTerminal: ServerTaskRecord = {
      ...active,
      id: 'lease-live-terminal',
      status: 'completed',
    }

    await store.update(() => ({ tasks: [...terminal, active, leaseLiveTerminal], result: true }))
    const retained = await store.readTasks()

    expect(retained).toHaveLength(1_002)
    expect(retained).toContainEqual(expect.objectContaining({ id: active.id, status: 'working' }))
    expect(retained).toContainEqual(
      expect.objectContaining({ id: leaseLiveTerminal.id, status: 'completed' }),
    )
    expect(retained.filter((task) => task.status === 'completed')).toHaveLength(1_001)
  })
})
