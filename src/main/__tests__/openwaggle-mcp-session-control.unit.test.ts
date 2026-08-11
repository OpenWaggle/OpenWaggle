import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  OpenWaggleMcpSessionMetadataStore,
  sessionMetadataStorePath,
} from '../openwaggle-mcp-session-metadata-store'
import { executeSessionOperation, sessionInputSchema } from '../openwaggle-mcp-session-tool'
import {
  SESSION_ID,
  serveOptions,
  sessionAdapters,
  sessionTasks,
} from './openwaggle-mcp-session-control.test-support'

vi.mock('electron', () => ({ app: { getPath: () => tmpdir() } }))

vi.mock('../openwaggle-mcp-session-worktree', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../openwaggle-mcp-session-worktree')>()),
  assertHostedSessionWorktreeProvenance: vi.fn(async () => undefined),
}))

let temporaryRoot = ''

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
    const options = serveOptions(temporaryRoot)
    const metadataPath = sessionMetadataStorePath(options.taskStorePath)
    const metadata = new OpenWaggleMcpSessionMetadataStore(metadataPath)
    const tasks = sessionTasks()
    const adapters = sessionAdapters(temporaryRoot)

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
    const adapters = sessionAdapters(temporaryRoot)

    await expect(
      executeSessionOperation(
        serveOptions(temporaryRoot, { grants: new Set() }),
        tasks,
        metadata,
        adapters,
        { operation: 'interrupt', sessionId: SESSION_ID },
      ),
    ).rejects.toThrow('lacks sessions:interrupt')
    await expect(
      executeSessionOperation(
        serveOptions(temporaryRoot, { originSessionId: SESSION_ID }),
        tasks,
        metadata,
        adapters,
        { operation: 'message', sessionId: SESSION_ID, objective: 'keep going' },
      ),
    ).rejects.toThrow('cannot target its own origin session')
    expect(tasks.start).not.toHaveBeenCalled()
  })

  it('waits for hosted cancellation to finish before starting a steering objective', async () => {
    const metadata = new OpenWaggleMcpSessionMetadataStore(
      sessionMetadataStorePath(path.join(temporaryRoot, 'tasks.json')),
    )
    const cancellation = Promise.withResolvers<boolean>()
    const start = vi.fn(async () => ({ status: 'queued' }))
    const tasks = {
      ...sessionTasks(),
      start,
      cancelSession: vi.fn(async () => 1),
      waitForSession: vi.fn(() => cancellation.promise),
    }
    const operation = executeSessionOperation(
      serveOptions(temporaryRoot, { sessionIds: new Set([SESSION_ID]) }),
      tasks,
      metadata,
      sessionAdapters(temporaryRoot),
      { operation: 'steer', sessionId: SESSION_ID, objective: 'Use the safer approach.' },
    )

    await vi.waitFor(() => expect(tasks.waitForSession).toHaveBeenCalledWith(SESSION_ID, 30_000))
    expect(start).not.toHaveBeenCalled()
    cancellation.resolve(true)
    await operation

    expect(start).toHaveBeenCalledWith({
      projectPath: temporaryRoot,
      sessionId: SESSION_ID,
      objective: 'Use the safer approach.',
    })
  })

  it('reports an unfinished steering cancellation without starting a replacement task', async () => {
    const metadata = new OpenWaggleMcpSessionMetadataStore(
      sessionMetadataStorePath(path.join(temporaryRoot, 'tasks.json')),
    )
    const tasks = {
      ...sessionTasks(),
      cancelSession: vi.fn(async () => 1),
      waitForSession: vi.fn(async () => false),
    }

    await expect(
      executeSessionOperation(
        serveOptions(temporaryRoot, { sessionIds: new Set([SESSION_ID]) }),
        tasks,
        metadata,
        sessionAdapters(temporaryRoot),
        {
          operation: 'steer',
          sessionId: SESSION_ID,
          objective: 'Do not lose this objective.',
          timeoutMs: 0,
        },
      ),
    ).rejects.toThrow('the steering objective was not started')
    expect(tasks.start).not.toHaveBeenCalled()
  })
})
