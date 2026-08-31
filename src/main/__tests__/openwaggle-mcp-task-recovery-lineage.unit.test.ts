import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { SessionId } from '@shared/types/brand'
import { Effect } from 'effect'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  OpenWaggleMcpSessionMetadataStore,
  sessionMetadataStorePath,
} from '../openwaggle-mcp-session-metadata-store'
import {
  OpenWaggleServerTaskManager,
  type OpenWaggleServerTaskServices,
} from '../openwaggle-mcp-task-manager'
import { OpenWaggleMcpTaskStore, type ServerTaskRecord } from '../openwaggle-mcp-task-store'
import { serveOptions } from './openwaggle-mcp-session-control.test-support'

vi.mock('electron', () => ({ app: { getPath: () => tmpdir() } }))

let temporaryRoot = ''

beforeEach(async () => {
  temporaryRoot = await mkdtemp(path.join(tmpdir(), 'openwaggle-task-lineage-recovery-'))
})

afterEach(async () => {
  await rm(temporaryRoot, { recursive: true, force: true })
})

function recoveryServices(): OpenWaggleServerTaskServices {
  return {
    resolveExecutionProfile: vi.fn(async () => ({
      model: 'provider/model',
      thinkingLevel: 'medium' as const,
    })),
    createOrReuseSession: vi.fn(async () => ({
      sessionId: SessionId('unused'),
      created: false,
    })),
    establishLineage: vi.fn(async () => undefined),
    setDelegationState: vi.fn(async () => undefined),
    execute: vi.fn(async () => ({ outcome: 'aborted' as const })),
  }
}

function expiredWorkers(profile: string): readonly ServerTaskRecord[] {
  return [
    {
      id: 'expired-worker',
      callerProfile: profile,
      projectPath: temporaryRoot,
      model: 'provider/model',
      objective: 'recover me',
      sessionId: 'worker-interrupted',
      status: 'working',
      lease: { ownerId: 'stopped-owner', expiresAt: 100 },
      createdAt: 1,
      updatedAt: 1,
    },
    {
      id: 'cancelled-worker',
      callerProfile: profile,
      projectPath: temporaryRoot,
      model: 'provider/model',
      objective: 'cancel me',
      sessionId: 'worker-cancelled',
      status: 'working',
      lease: { ownerId: 'stopped-owner', expiresAt: 100 },
      cancellationRequestedAt: 90,
      createdAt: 1,
      updatedAt: 90,
    },
  ]
}

describe('hosted MCP task lineage recovery', () => {
  it('projects recovered task terminals into their linked worker sessions', async () => {
    const options = serveOptions(temporaryRoot)
    const store = new OpenWaggleMcpTaskStore(options.taskStorePath)
    await store.update(() => ({ tasks: expiredWorkers(options.profile), result: true }))
    const services = recoveryServices()
    const metadata = new OpenWaggleMcpSessionMetadataStore(
      sessionMetadataStorePath(options.taskStorePath),
    )
    const manager = new OpenWaggleServerTaskManager(options, metadata, services, {
      now: () => 101,
    })

    await Effect.runPromise(manager.recoverInterruptedTasks())

    expect(services.setDelegationState).toHaveBeenCalledWith(
      SessionId('worker-interrupted'),
      'needs_attention',
    )
    expect(services.setDelegationState).toHaveBeenCalledWith(
      SessionId('worker-cancelled'),
      'cancelled',
    )
    await expect(store.readTasks()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'expired-worker',
          projectedDelegationState: 'needs_attention',
        }),
        expect.objectContaining({
          id: 'cancelled-worker',
          projectedDelegationState: 'cancelled',
        }),
      ]),
    )
  })

  it('retries an unacknowledged terminal lineage projection until it succeeds', async () => {
    const options = serveOptions(temporaryRoot)
    const store = new OpenWaggleMcpTaskStore(options.taskStorePath)
    await store.update(() => ({
      tasks: [
        {
          id: 'completed-worker',
          callerProfile: options.profile,
          projectPath: temporaryRoot,
          model: 'provider/model',
          objective: 'already complete',
          sessionId: 'worker-completed',
          status: 'completed',
          createdAt: 1,
          updatedAt: 2,
        },
      ],
      result: true,
    }))
    const services = recoveryServices()
    vi.mocked(services.setDelegationState)
      .mockRejectedValueOnce(new Error('session database temporarily unavailable'))
      .mockResolvedValue(undefined)
    const metadata = new OpenWaggleMcpSessionMetadataStore(
      sessionMetadataStorePath(options.taskStorePath),
    )
    const manager = new OpenWaggleServerTaskManager(options, metadata, services)

    await Effect.runPromise(manager.recoverInterruptedTasks())
    await Effect.runPromise(manager.recoverInterruptedTasks())
    await Effect.runPromise(manager.recoverInterruptedTasks())

    expect(services.setDelegationState).toHaveBeenCalledTimes(2)
    expect(services.setDelegationState).toHaveBeenNthCalledWith(
      2,
      SessionId('worker-completed'),
      'accepted',
    )
    await expect(store.readTasks()).resolves.toEqual([
      expect.objectContaining({ projectedDelegationState: 'accepted' }),
    ])
  })

  it('does not replay an older terminal state over a newer active task', async () => {
    const options = serveOptions(temporaryRoot)
    const store = new OpenWaggleMcpTaskStore(options.taskStorePath)
    await store.update(() => ({
      tasks: [
        {
          id: 'older-completed-worker',
          callerProfile: options.profile,
          projectPath: temporaryRoot,
          model: 'provider/model',
          objective: 'older work',
          sessionId: 'reused-worker',
          status: 'completed',
          createdAt: 1,
          updatedAt: 5,
        },
        {
          id: 'newer-active-worker',
          callerProfile: 'other-profile',
          projectPath: temporaryRoot,
          model: 'provider/model',
          objective: 'newer work',
          sessionId: 'reused-worker',
          status: 'working',
          lease: { ownerId: 'live-owner', expiresAt: 100 },
          createdAt: 2,
          updatedAt: 2,
        },
      ],
      result: true,
    }))
    const services = recoveryServices()
    const metadata = new OpenWaggleMcpSessionMetadataStore(
      sessionMetadataStorePath(options.taskStorePath),
    )
    const manager = new OpenWaggleServerTaskManager(options, metadata, services, {
      now: () => 10,
    })

    await Effect.runPromise(manager.recoverInterruptedTasks())

    expect(services.setDelegationState).not.toHaveBeenCalled()
  })

  it('projects only the newest terminal task for a reused session', async () => {
    const options = serveOptions(temporaryRoot)
    const store = new OpenWaggleMcpTaskStore(options.taskStorePath)
    await store.update(() => ({
      tasks: [
        {
          id: 'older-cancelled-worker',
          callerProfile: options.profile,
          projectPath: temporaryRoot,
          model: 'provider/model',
          objective: 'older work',
          sessionId: 'reused-worker',
          status: 'cancelled',
          createdAt: 1,
          updatedAt: 10,
        },
        {
          id: 'newer-completed-worker',
          callerProfile: options.profile,
          projectPath: temporaryRoot,
          model: 'provider/model',
          objective: 'newer work',
          sessionId: 'reused-worker',
          status: 'completed',
          createdAt: 2,
          updatedAt: 3,
        },
      ],
      result: true,
    }))
    const services = recoveryServices()
    const metadata = new OpenWaggleMcpSessionMetadataStore(
      sessionMetadataStorePath(options.taskStorePath),
    )
    const manager = new OpenWaggleServerTaskManager(options, metadata, services)

    await Effect.runPromise(manager.recoverInterruptedTasks())

    expect(services.setDelegationState).toHaveBeenCalledTimes(1)
    expect(services.setDelegationState).toHaveBeenCalledWith(SessionId('reused-worker'), 'accepted')
    const tasks = await store.readTasks()
    expect(tasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'newer-completed-worker',
          projectedDelegationState: 'accepted',
        }),
      ]),
    )
    expect(tasks.find(({ id }) => id === 'older-cancelled-worker')).not.toHaveProperty(
      'projectedDelegationState',
    )
  })

  it('projects direct cancellation after an expired lease', async () => {
    const options = serveOptions(temporaryRoot)
    const store = new OpenWaggleMcpTaskStore(options.taskStorePath)
    const [worker] = expiredWorkers(options.profile)
    if (!worker) throw new Error('Expected an expired worker fixture.')
    await store.update(() => ({ tasks: [worker], result: true }))
    const services = recoveryServices()
    const metadata = new OpenWaggleMcpSessionMetadataStore(
      sessionMetadataStorePath(options.taskStorePath),
    )
    const manager = new OpenWaggleServerTaskManager(options, metadata, services, {
      now: () => 101,
    })

    await Effect.runPromise(manager.cancel(worker.id))

    expect(services.setDelegationState).toHaveBeenCalledWith(
      SessionId('worker-interrupted'),
      'cancelled',
    )
  })

  it('projects session cancellation after expired leases', async () => {
    const options = serveOptions(temporaryRoot)
    const store = new OpenWaggleMcpTaskStore(options.taskStorePath)
    const [worker] = expiredWorkers(options.profile)
    if (!worker?.sessionId) throw new Error('Expected a linked expired worker fixture.')
    await store.update(() => ({ tasks: [worker], result: true }))
    const services = recoveryServices()
    const metadata = new OpenWaggleMcpSessionMetadataStore(
      sessionMetadataStorePath(options.taskStorePath),
    )
    const manager = new OpenWaggleServerTaskManager(options, metadata, services, {
      now: () => 101,
    })

    await Effect.runPromise(manager.cancelSession(worker.sessionId))

    expect(services.setDelegationState).toHaveBeenCalledWith(
      SessionId('worker-interrupted'),
      'cancelled',
    )
  })
})
