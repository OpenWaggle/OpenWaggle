import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { reconcileOpenWaggleProfileTasks } from '../openwaggle-mcp-task-reconciliation'
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
  it('retries restoration when an older terminal projection finishes late', async () => {
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
        if (state === 'working' && correctiveAttempts++ === 0) {
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
    expect((await store.readTasks()).find(({ id }) => id === 'older-completed')).not.toHaveProperty(
      'projectedDelegationState',
    )
  })
})
