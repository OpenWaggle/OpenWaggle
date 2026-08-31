import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { SessionId } from '@shared/types/brand'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  projectTaskStateIfAuthoritative,
  reconcileOpenWaggleProfileTasks,
} from '../openwaggle-mcp-task-reconciliation'
import type { OpenWaggleServerTaskServices } from '../openwaggle-mcp-task-runtime'
import { OpenWaggleMcpTaskStore } from '../openwaggle-mcp-task-store'

vi.mock('electron', () => ({ app: { getPath: () => tmpdir() } }))

let temporaryRoot = ''

beforeEach(async () => {
  temporaryRoot = await mkdtemp(path.join(tmpdir(), 'openwaggle-reconcile-authority-'))
})

afterEach(async () => {
  await rm(temporaryRoot, { recursive: true, force: true })
})

describe('hosted task reconciliation authority', () => {
  it('invalidates a stale acknowledgement before retrying later', async () => {
    const store = new OpenWaggleMcpTaskStore(path.join(temporaryRoot, 'tasks.json'))
    await store.update(() => ({
      tasks: [
        {
          id: 'older-completed',
          callerProfile: 'test-profile',
          projectPath: temporaryRoot,
          model: 'provider/model',
          objective: 'older work',
          sessionId: 'reused-session',
          status: 'completed',
          createdAt: 1,
          updatedAt: 2,
        },
      ],
      result: true,
    }))
    const projectedStates: string[] = []
    let correctiveAttempts = 0
    let releaseAccepted = () => {}
    let markAcceptedStarted = () => {}
    const acceptedStarted = new Promise<void>((resolve) => {
      markAcceptedStarted = resolve
    })
    const acceptedBlocked = new Promise<void>((resolve) => {
      releaseAccepted = resolve
    })
    const services: OpenWaggleServerTaskServices = {
      resolveExecutionProfile: vi.fn(),
      createOrReuseSession: vi.fn(),
      establishLineage: vi.fn(),
      execute: vi.fn(),
      setDelegationState: vi.fn(async (_sessionId, state) => {
        if (state === 'accepted') {
          markAcceptedStarted()
          await acceptedBlocked
        }
        projectedStates.push(state)
        if (state === 'working' && correctiveAttempts++ < 2) {
          throw new Error('session database temporarily unavailable')
        }
      }),
    }
    const reconciliation = reconcileOpenWaggleProfileTasks({
      now: 10,
      profile: 'test-profile',
      services,
      store,
    })
    await acceptedStarted
    await store.update((tasks) => ({
      tasks: [
        ...tasks,
        {
          id: 'newer-working',
          callerProfile: 'test-profile',
          projectPath: temporaryRoot,
          model: 'provider/model',
          objective: 'newer work',
          sessionId: 'reused-session',
          status: 'working',
          lease: { ownerId: 'live-owner', expiresAt: 100 },
          projectedDelegationState: 'working',
          createdAt: 3,
          updatedAt: 3,
        },
      ],
      result: true,
    }))
    projectedStates.push('working')

    releaseAccepted()
    await reconciliation

    expect(projectedStates).toEqual(['working', 'accepted', 'working', 'working'])
    expect((await store.readTasks()).find(({ id }) => id === 'newer-working')).not.toHaveProperty(
      'projectedDelegationState',
    )
    await reconcileOpenWaggleProfileTasks({
      now: 10,
      profile: 'test-profile',
      services,
      store,
    })

    expect(projectedStates).toEqual(['working', 'accepted', 'working', 'working', 'working'])
    expect((await store.readTasks()).find(({ id }) => id === 'newer-working')).toMatchObject({
      projectedDelegationState: 'working',
    })
    expect((await store.readTasks()).find(({ id }) => id === 'older-completed')).not.toHaveProperty(
      'projectedDelegationState',
    )
  })

  it('revalidates authority after a successful corrective projection', async () => {
    const store = new OpenWaggleMcpTaskStore(path.join(temporaryRoot, 'tasks.json'))
    await store.update(() => ({
      tasks: [
        {
          id: 'older-completed',
          callerProfile: 'test-profile',
          projectPath: temporaryRoot,
          model: 'provider/model',
          objective: 'older work',
          sessionId: 'reused-session',
          status: 'completed',
          createdAt: 1,
          updatedAt: 2,
        },
      ],
      result: true,
    }))
    const projectedStates: string[] = []
    let acceptedCalls = 0
    let releaseInitialAccepted = () => {}
    let releaseWorking = () => {}
    let markInitialAcceptedStarted = () => {}
    let markWorkingStarted = () => {}
    const initialAcceptedStarted = new Promise<void>((resolve) => {
      markInitialAcceptedStarted = resolve
    })
    const initialAcceptedBlocked = new Promise<void>((resolve) => {
      releaseInitialAccepted = resolve
    })
    const workingStarted = new Promise<void>((resolve) => {
      markWorkingStarted = resolve
    })
    const workingBlocked = new Promise<void>((resolve) => {
      releaseWorking = resolve
    })
    const services: OpenWaggleServerTaskServices = {
      resolveExecutionProfile: vi.fn(),
      createOrReuseSession: vi.fn(),
      establishLineage: vi.fn(),
      execute: vi.fn(),
      setDelegationState: vi.fn(async (_sessionId, state) => {
        if (state === 'accepted' && acceptedCalls++ === 0) {
          markInitialAcceptedStarted()
          await initialAcceptedBlocked
        }
        if (state === 'working') {
          markWorkingStarted()
          await workingBlocked
        }
        projectedStates.push(state)
      }),
    }
    const projection = projectTaskStateIfAuthoritative(
      { services, store },
      'older-completed',
      SessionId('reused-session'),
      'accepted',
    )
    await initialAcceptedStarted
    await store.update((tasks) => ({
      tasks: [
        ...tasks,
        {
          id: 'newer-working',
          callerProfile: 'test-profile',
          projectPath: temporaryRoot,
          model: 'provider/model',
          objective: 'newer work',
          sessionId: 'reused-session',
          status: 'working',
          lease: { ownerId: 'live-owner', expiresAt: 100 },
          createdAt: 3,
          updatedAt: 3,
        },
      ],
      result: true,
    }))
    releaseInitialAccepted()
    await workingStarted
    await store.update((tasks) => ({
      tasks: tasks.map((task) =>
        task.id === 'newer-working'
          ? { ...task, status: 'completed' as const, lease: null, updatedAt: 4 }
          : task,
      ),
      result: true,
    }))
    projectedStates.push('accepted')
    releaseWorking()

    await projection

    expect(projectedStates).toEqual(['accepted', 'accepted', 'working', 'accepted'])
  })
})
