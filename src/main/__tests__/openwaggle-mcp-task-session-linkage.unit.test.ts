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
import { serveOptions } from './openwaggle-mcp-session-control.test-support'
import { waitForTaskStatus } from './openwaggle-mcp-task-leases.test-support'

vi.mock('electron', () => ({ app: { getPath: () => tmpdir() } }))

let temporaryRoot = ''
let managers: OpenWaggleServerTaskManager[] = []

beforeEach(async () => {
  temporaryRoot = await mkdtemp(path.join(tmpdir(), 'openwaggle-task-session-linkage-'))
  managers = []
})

afterEach(async () => {
  await Promise.all(managers.map((manager) => Effect.runPromise(manager.cancelAll())))
  await rm(temporaryRoot, { recursive: true, force: true })
})

function metadata(taskStorePath: string) {
  return new OpenWaggleMcpSessionMetadataStore(sessionMetadataStorePath(taskStorePath))
}

function services(): OpenWaggleServerTaskServices {
  return {
    resolveExecutionProfile: vi.fn(async () => ({
      model: 'provider/model',
      thinkingLevel: 'medium' as const,
    })),
    createOrReuseSession: vi.fn(async (task) => ({
      sessionId: SessionId(task.sessionId ?? `created-${task.id}`),
      created: !task.sessionId,
    })),
    establishLineage: vi.fn(async () => undefined),
    setDelegationState: vi.fn(async () => undefined),
    execute: vi.fn(async ({ signal }) => {
      if (signal.aborted) return { outcome: 'aborted' as const }
      return new Promise<{ readonly outcome: 'aborted' }>((resolve) => {
        signal.addEventListener('abort', () => resolve({ outcome: 'aborted' }), { once: true })
      })
    }),
  }
}

function track(manager: OpenWaggleServerTaskManager) {
  managers.push(manager)
  return manager
}

describe('hosted MCP task session linkage', () => {
  it('links a newly created session when metadata setup fails', async () => {
    const options = serveOptions(temporaryRoot)
    const sessionMetadata = metadata(options.taskStorePath)
    vi.spyOn(sessionMetadata, 'update').mockRejectedValue(new Error('metadata unavailable'))
    const manager = track(new OpenWaggleServerTaskManager(options, sessionMetadata, services()))
    const task = await Effect.runPromise(
      manager.start({ projectPath: temporaryRoot, objective: 'fail after session creation' }),
    )

    const failed = await waitForTaskStatus(manager, task.id, 'failed')

    expect(failed.sessionId).toBe(`created-${task.id}`)
    await expect(Effect.runPromise(manager.listForSession(`created-${task.id}`))).resolves.toEqual([
      expect.objectContaining({ id: task.id, status: 'failed' }),
    ])
  })

  it('links a newly created session when cancellation wins before execution', async () => {
    const options = { ...serveOptions(temporaryRoot), originSessionId: 'parent-session' }
    const taskServices = services()
    let releaseLineage = () => {}
    const lineageBlocked = new Promise<void>((resolve) => {
      releaseLineage = resolve
    })
    vi.mocked(taskServices.establishLineage).mockImplementation(() => lineageBlocked)
    const owner = track(
      new OpenWaggleServerTaskManager(options, metadata(options.taskStorePath), taskServices, {
        ownerId: 'owner-a',
      }),
    )
    const remote = track(
      new OpenWaggleServerTaskManager(options, metadata(options.taskStorePath), services(), {
        ownerId: 'owner-b',
      }),
    )
    const task = await Effect.runPromise(
      owner.start({ projectPath: temporaryRoot, objective: 'cancel during lineage setup' }),
    )
    await vi.waitFor(() => expect(taskServices.establishLineage).toHaveBeenCalledOnce())

    await Effect.runPromise(remote.cancel(task.id))
    releaseLineage()
    const cancelled = await waitForTaskStatus(owner, task.id, 'cancelled')

    expect(cancelled.sessionId).toBe(`created-${task.id}`)
  })
})
