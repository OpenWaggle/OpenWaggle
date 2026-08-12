import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { MCP_CONFIG } from '@shared/constants/mcp'
import { SessionId } from '@shared/types/brand'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  OpenWaggleMcpSessionMetadataStore,
  sessionMetadataStorePath,
} from '../openwaggle-mcp-session-metadata-store'
import { executeSessionOperation } from '../openwaggle-mcp-session-tool'
import {
  SESSION_ID,
  serveOptions,
  session,
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
  temporaryRoot = await mkdtemp(path.join(tmpdir(), 'openwaggle-session-derivation-'))
})

afterEach(async () => {
  await rm(temporaryRoot, { recursive: true, force: true })
})

describe('hosted MCP session derivation', () => {
  it('forks with the target model and idempotently materializes a worktree session', async () => {
    const options = serveOptions(temporaryRoot, { sessionIds: new Set([SESSION_ID]) })
    const metadata = new OpenWaggleMcpSessionMetadataStore(
      sessionMetadataStorePath(options.taskStorePath),
    )
    const tasks = sessionTasks()
    const copiedSession = session(temporaryRoot, {
      id: SessionId('session-copy'),
      title: 'Copied session',
    })
    const worktreeProjectPath = path.join(temporaryRoot, 'worktree')
    const worktreeSession = session(temporaryRoot, {
      id: SessionId('session-worktree'),
      title: 'Worktree session',
      projectPath: worktreeProjectPath,
    })
    const copySession = vi.fn(async () => ({ cancelled: false, session: copiedSession }))
    const materializeWorktree = vi.fn(async () => ({
      sourceProjectPath: temporaryRoot,
      projectPath: worktreeProjectPath,
      branch: 'ow/session-target',
      baseRef: 'main',
      created: true,
    }))
    const createSessionAtProjectPath = vi.fn(async () => worktreeSession)
    const adapters = {
      loadSession: vi.fn(async (sessionId: string) => {
        if (sessionId === worktreeSession.id) return worktreeSession
        if (sessionId === copiedSession.id) return copiedSession
        return session(temporaryRoot)
      }),
      copySession,
      materializeWorktree,
      createSessionAtProjectPath,
    }

    const forked = await executeSessionOperation(options, tasks, metadata, adapters, {
      operation: 'fork',
      sessionId: SESSION_ID,
      targetNodeId: 'target-node',
    })
    await executeSessionOperation(options, tasks, metadata, adapters, {
      operation: 'plan-worktree',
      sessionId: SESSION_ID,
      baseRef: 'main',
    })
    const secondProcessMetadata = new OpenWaggleMcpSessionMetadataStore(
      sessionMetadataStorePath(options.taskStorePath),
    )
    const [worktree, retried] = await Promise.all([
      executeSessionOperation(options, tasks, metadata, adapters, {
        operation: 'create-worktree',
        sessionId: SESSION_ID,
      }),
      executeSessionOperation(options, tasks, secondProcessMetadata, adapters, {
        operation: 'create-worktree',
        sessionId: SESSION_ID,
      }),
    ])
    const copiedStatus = await executeSessionOperation(options, tasks, metadata, adapters, {
      operation: 'status',
      sessionId: copiedSession.id,
    })

    expect(copySession).toHaveBeenCalledWith({
      operation: 'fork',
      sessionId: SESSION_ID,
      targetNodeId: 'target-node',
      model: 'provider/model',
    })
    expect(forked.structuredContent).toMatchObject({ delegationDepth: 1 })
    expect(copiedStatus.structuredContent).toMatchObject({ session: { id: copiedSession.id } })
    expect(await metadata.depth(copiedSession.id)).toBe(1)
    expect(materializeWorktree).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceSessionId: SESSION_ID,
        sourceProjectPath: await realpath(temporaryRoot),
        baseRef: 'main',
        startFromOrigin: false,
      }),
    )
    expect(worktree.structuredContent).toMatchObject({
      sourceSessionId: SESSION_ID,
      derivedSessionId: worktreeSession.id,
      worktree: { projectPath: worktreeProjectPath },
      completed: true,
    })
    expect(retried.structuredContent).toMatchObject({ derivedSessionId: worktreeSession.id })
    expect(createSessionAtProjectPath).toHaveBeenCalledTimes(1)
    await expect(
      executeSessionOperation(options, tasks, metadata, adapters, {
        operation: 'create-worktree',
        sessionId: SESSION_ID,
        baseRef: 'other',
      }),
    ).rejects.toThrow('cannot be changed')
  })

  it('requires create and organize grants before materializing a worktree', async () => {
    const options = serveOptions(temporaryRoot, { grants: new Set(['sessions:organize']) })
    const metadata = new OpenWaggleMcpSessionMetadataStore(
      sessionMetadataStorePath(options.taskStorePath),
    )
    const adapters = sessionAdapters(temporaryRoot)
    await expect(
      executeSessionOperation(options, sessionTasks(), metadata, adapters, {
        operation: 'create-worktree',
        sessionId: SESSION_ID,
      }),
    ).rejects.toThrow('lacks sessions:create')
    expect(adapters.materializeWorktree).not.toHaveBeenCalled()
  })

  it('lets a session grant derive from its source but not create arbitrary roots', async () => {
    const options = serveOptions(temporaryRoot, { sessionIds: new Set([SESSION_ID]) })
    const metadata = new OpenWaggleMcpSessionMetadataStore(
      sessionMetadataStorePath(options.taskStorePath),
    )
    const adapters = {
      ...sessionAdapters(temporaryRoot),
      createSessionAtProjectPath: vi.fn(async ({ projectPath }: { projectPath: string }) =>
        session(temporaryRoot, { id: SessionId('session-derived'), projectPath }),
      ),
    }
    await expect(
      executeSessionOperation(options, sessionTasks(), metadata, adapters, {
        operation: 'create-worktree',
        sessionId: SESSION_ID,
      }),
    ).resolves.toMatchObject({ structuredContent: { sourceSessionId: SESSION_ID } })
    await expect(
      executeSessionOperation(options, sessionTasks(), metadata, adapters, {
        operation: 'create',
        projectPath: temporaryRoot,
      }),
    ).rejects.toThrow('explicit --workspace grant')
  })

  it('checks source depth before creating Git worktree state', async () => {
    const options = serveOptions(temporaryRoot)
    const metadata = new OpenWaggleMcpSessionMetadataStore(
      sessionMetadataStorePath(options.taskStorePath),
    )
    await metadata.setDepth(SESSION_ID, MCP_CONFIG.MAX_ORCHESTRATION_DEPTH)
    const adapters = sessionAdapters(temporaryRoot)
    await expect(
      executeSessionOperation(options, sessionTasks(), metadata, adapters, {
        operation: 'create-worktree',
        sessionId: SESSION_ID,
      }),
    ).rejects.toThrow('maximum hosted session depth')
    expect(adapters.materializeWorktree).not.toHaveBeenCalled()
  })

  it('authorizes a derived session through provenance and executes in its worktree', async () => {
    const sourceProjectPath = path.join(temporaryRoot, 'source')
    const worktreeProjectPath = path.join(temporaryRoot, 'outside-grant-worktree')
    await Promise.all([
      mkdir(sourceProjectPath, { recursive: true }),
      mkdir(worktreeProjectPath, { recursive: true }),
    ])
    const worktreeSessionId = SessionId('session-derived-worktree')
    const options = serveOptions(temporaryRoot, {
      workspaceRoots: [sourceProjectPath],
      sessionIds: new Set([SESSION_ID]),
    })
    const metadata = new OpenWaggleMcpSessionMetadataStore(
      sessionMetadataStorePath(options.taskStorePath),
    )
    await metadata.update(worktreeSessionId, (current) => ({
      ...current,
      worktree: {
        sourceSessionId: SESSION_ID,
        sourceProjectPath,
        projectPath: worktreeProjectPath,
        branch: 'ow/session-derived',
        baseRef: 'main',
        requestedBaseRef: 'main',
        startFromOrigin: false,
        createdAt: Date.now(),
      },
      updatedAt: Date.now(),
    }))
    const tasks = sessionTasks()
    const adapters = {
      ...sessionAdapters(temporaryRoot),
      loadSession: vi.fn(async (sessionId: string) =>
        sessionId === worktreeSessionId
          ? session(temporaryRoot, { id: worktreeSessionId, projectPath: worktreeProjectPath })
          : session(temporaryRoot, { projectPath: sourceProjectPath }),
      ),
    }
    await executeSessionOperation(options, tasks, metadata, adapters, {
      operation: 'message',
      sessionId: worktreeSessionId,
      objective: 'Continue inside the hosted worktree.',
    })
    expect(tasks.start).toHaveBeenCalledWith({
      projectPath: worktreeProjectPath,
      sessionId: worktreeSessionId,
      objective: 'Continue inside the hosted worktree.',
    })
  })
})
