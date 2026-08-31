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
import {
  OpenWaggleMcpTaskStore,
  type ServerTaskLease,
  type ServerTaskRecord,
  type ServerTaskStatus,
} from '../openwaggle-mcp-task-store'
import { serveOptions } from './openwaggle-mcp-session-control.test-support'

vi.mock('electron', () => ({ app: { getPath: () => tmpdir() } }))

let temporaryRoot = ''

beforeEach(async () => {
  temporaryRoot = await mkdtemp(path.join(tmpdir(), 'openwaggle-task-cancellation-lineage-'))
})

afterEach(async () => {
  await rm(temporaryRoot, { recursive: true, force: true })
})

function cancellationServices(): OpenWaggleServerTaskServices {
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

function linkedTask(input: {
  readonly id: string
  readonly profile: string
  readonly status: ServerTaskStatus
  readonly createdAt: number
  readonly sessionId?: string
  readonly updatedAt?: number
  readonly lease?: ServerTaskLease | null
}): ServerTaskRecord {
  return {
    id: input.id,
    callerProfile: input.profile,
    projectPath: temporaryRoot,
    model: 'provider/model',
    objective: `${input.id} objective`,
    sessionId: input.sessionId ?? 'reused-worker',
    status: input.status,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt ?? input.createdAt,
    ...(input.lease === undefined ? {} : { lease: input.lease }),
  }
}

function managerFor(taskStorePath: string, services: OpenWaggleServerTaskServices, now: number) {
  return new OpenWaggleServerTaskManager(
    serveOptions(temporaryRoot),
    new OpenWaggleMcpSessionMetadataStore(sessionMetadataStorePath(taskStorePath)),
    services,
    { now: () => now },
  )
}

describe('hosted MCP task cancellation lineage', () => {
  it('projects direct cancellation after an expired lease', async () => {
    const options = serveOptions(temporaryRoot)
    const store = new OpenWaggleMcpTaskStore(options.taskStorePath)
    const worker = linkedTask({
      id: 'expired-worker',
      profile: options.profile,
      status: 'working',
      sessionId: 'worker-interrupted',
      createdAt: 1,
      lease: { ownerId: 'stopped-owner', expiresAt: 100 },
    })
    await store.update(() => ({ tasks: [worker], result: true }))
    const services = cancellationServices()
    const manager = managerFor(options.taskStorePath, services, 101)

    await Effect.runPromise(manager.cancel(worker.id))

    expect(services.setDelegationState).toHaveBeenCalledWith(
      SessionId('worker-interrupted'),
      'cancelled',
    )
  })

  it('does not re-project an already-cancelled task after its session is reused', async () => {
    const options = serveOptions(temporaryRoot)
    const store = new OpenWaggleMcpTaskStore(options.taskStorePath)
    await store.update(() => ({
      tasks: [
        linkedTask({
          id: 'older-cancelled-worker',
          profile: options.profile,
          status: 'cancelled',
          createdAt: 1,
        }),
        linkedTask({
          id: 'newer-active-worker',
          profile: 'other-profile',
          status: 'working',
          createdAt: 2,
          lease: { ownerId: 'live-owner', expiresAt: 100 },
        }),
      ],
      result: true,
    }))
    const services = cancellationServices()
    const manager = managerFor(options.taskStorePath, services, 10)

    await Effect.runPromise(manager.cancel('older-cancelled-worker'))

    expect(services.setDelegationState).not.toHaveBeenCalled()
  })

  it('does not project an expired cancellation over a newer authoritative task', async () => {
    const options = serveOptions(temporaryRoot)
    const store = new OpenWaggleMcpTaskStore(options.taskStorePath)
    const tasks = [
      linkedTask({
        id: 'older-expired-worker',
        profile: options.profile,
        status: 'working',
        createdAt: 1,
        lease: { ownerId: 'stopped-owner', expiresAt: 5 },
      }),
      linkedTask({
        id: 'newer-active-worker',
        profile: 'other-profile',
        status: 'working',
        createdAt: 2,
        lease: { ownerId: 'live-owner', expiresAt: 100 },
      }),
    ]
    await store.update(() => ({ tasks, result: true }))
    const services = cancellationServices()
    const manager = managerFor(options.taskStorePath, services, 10)

    await Effect.runPromise(manager.cancel('older-expired-worker'))
    expect(services.setDelegationState).not.toHaveBeenCalled()

    await store.update(() => ({ tasks, result: true }))
    await Effect.runPromise(manager.cancelSession('reused-worker'))
    expect(services.setDelegationState).not.toHaveBeenCalled()
  })

  it('projects authoritative session cancellation after an expired lease', async () => {
    const options = serveOptions(temporaryRoot)
    const store = new OpenWaggleMcpTaskStore(options.taskStorePath)
    const worker = linkedTask({
      id: 'expired-worker',
      profile: options.profile,
      status: 'working',
      sessionId: 'worker-interrupted',
      createdAt: 1,
      lease: { ownerId: 'stopped-owner', expiresAt: 100 },
    })
    await store.update(() => ({ tasks: [worker], result: true }))
    const services = cancellationServices()
    const manager = managerFor(options.taskStorePath, services, 101)

    await Effect.runPromise(manager.cancelSession('worker-interrupted'))

    expect(services.setDelegationState).toHaveBeenCalledWith(
      SessionId('worker-interrupted'),
      'cancelled',
    )
  })
})
