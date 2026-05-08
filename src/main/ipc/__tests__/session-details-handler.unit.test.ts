import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { SessionId, SessionNodeId, SupportedModelId } from '@shared/types/brand'
import { DEFAULT_SETTINGS } from '@shared/types/settings'
import { Layer } from 'effect'
import * as Effect from 'effect/Effect'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionProjectionRepositoryError } from '../../errors'
import { AgentKernelService } from '../../ports/agent-kernel-service'
import { ProviderService } from '../../ports/provider-service'
import { SessionProjectionRepository } from '../../ports/session-projection-repository'
import { SessionRepository } from '../../ports/session-repository'
import { SettingsService } from '../../services/settings-service'

const {
  typedHandleMock,
  cleanupSessionRunMock,
  createRuntimeSessionMock,
  forkRuntimeSessionMock,
  persistSnapshotMock,
  listSessionDetailsMock,
  getSessionDetailMock,
  createSessionMock,
  deleteSessionMock,
  archiveSessionMock,
  unarchiveSessionMock,
  listArchivedSessionsMock,
  updateSessionTitleMock,
} = vi.hoisted(() => ({
  typedHandleMock: vi.fn(),
  cleanupSessionRunMock: vi.fn(),
  createRuntimeSessionMock: vi.fn(async (_input: { readonly projectPath: string }) => ({
    piSessionId: 'pi-session-created',
    piSessionFile: '/tmp/pi-session-created.jsonl',
  })),
  forkRuntimeSessionMock: vi.fn(),
  persistSnapshotMock: vi.fn(),
  listSessionDetailsMock: vi.fn(),
  getSessionDetailMock: vi.fn(),
  createSessionMock: vi.fn(),
  deleteSessionMock: vi.fn(),
  archiveSessionMock: vi.fn(),
  unarchiveSessionMock: vi.fn(),
  listArchivedSessionsMock: vi.fn(),
  updateSessionTitleMock: vi.fn(),
}))

vi.mock('../typed-ipc', () => ({
  typedHandle: typedHandleMock,
}))

vi.mock('../../agent/session-cleanup', () => ({
  cleanupSessionRun: cleanupSessionRunMock,
}))

const TestSessionProjectionRepoLayer = Layer.succeed(
  SessionProjectionRepository,
  SessionProjectionRepository.of({
    get: (id) =>
      Effect.tryPromise({
        try: async () => getSessionDetailMock(id),
        catch: (cause) => new SessionProjectionRepositoryError({ operation: 'get', cause }),
      }),
    getOptional: (id) =>
      Effect.tryPromise({
        try: async () => getSessionDetailMock(id),
        catch: (cause) => new SessionProjectionRepositoryError({ operation: 'getOptional', cause }),
      }),
    list: (limit) =>
      Effect.tryPromise({
        try: async () => listArchivedSessionsMock(limit),
        catch: (cause) => new SessionProjectionRepositoryError({ operation: 'list', cause }),
      }),
    listDetails: (limit) =>
      Effect.tryPromise({
        try: async () => listSessionDetailsMock(limit),
        catch: (cause) => new SessionProjectionRepositoryError({ operation: 'listDetails', cause }),
      }),
    create: (input) =>
      Effect.tryPromise({
        try: async () => createSessionMock(input),
        catch: (cause) => new SessionProjectionRepositoryError({ operation: 'create', cause }),
      }),
    delete: (id) =>
      Effect.tryPromise({
        try: async () => {
          await deleteSessionMock(id)
        },
        catch: (cause) => new SessionProjectionRepositoryError({ operation: 'delete', cause }),
      }),
    archive: (id) =>
      Effect.tryPromise({
        try: async () => {
          await archiveSessionMock(id)
        },
        catch: (cause) => new SessionProjectionRepositoryError({ operation: 'archive', cause }),
      }),
    unarchive: (id) =>
      Effect.tryPromise({
        try: async () => {
          await unarchiveSessionMock(id)
        },
        catch: (cause) => new SessionProjectionRepositoryError({ operation: 'unarchive', cause }),
      }),
    listArchived: () =>
      Effect.tryPromise({
        try: async () => listArchivedSessionsMock(),
        catch: (cause) =>
          new SessionProjectionRepositoryError({ operation: 'listArchived', cause }),
      }),
    updateTitle: (id, title) =>
      Effect.tryPromise({
        try: async () => {
          await updateSessionTitleMock(id, title)
        },
        catch: (cause) => new SessionProjectionRepositoryError({ operation: 'updateTitle', cause }),
      }),
  }),
)

const TestAgentKernelLayer = Layer.succeed(
  AgentKernelService,
  AgentKernelService.of({
    createSession: (input) =>
      Effect.tryPromise({
        try: async () => createRuntimeSessionMock(input),
        catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
      }),
    run: () => Effect.fail(new Error('agent run not used by session detail handler tests')),
    runWaggle: () => Effect.fail(new Error('Waggle run not used by session detail handler tests')),
    getContextUsage: () =>
      Effect.fail(new Error('context usage not used by session detail handler tests')),
    compact: () => Effect.fail(new Error('compaction not used by session detail handler tests')),
    navigateTree: () =>
      Effect.fail(new Error('tree navigation not used by session detail handler tests')),
    forkSession: (input) =>
      Effect.tryPromise({
        try: async () => forkRuntimeSessionMock(input),
        catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
      }),
    getSessionSnapshot: () =>
      Effect.fail(new Error('session snapshot not used by session detail handler tests')),
  }),
)

const TestSessionRepoLayer = Layer.succeed(
  SessionRepository,
  SessionRepository.of({
    list: () => Effect.succeed([]),
    listArchivedBranches: () => Effect.succeed([]),
    getTree: () => Effect.succeed(null),
    getWorkspace: () => Effect.succeed(null),
    persistSnapshot: (input) =>
      Effect.sync(() => {
        persistSnapshotMock(input)
      }),
    updateRuntime: () => Effect.void,
    renameBranch: () => Effect.void,
    archiveBranch: () => Effect.void,
    restoreBranch: () => Effect.void,
    updateTreeUiState: () => Effect.void,
    recordActiveRun: () => Effect.void,
    clearActiveRun: () => Effect.void,
    clearInterruptedRuns: () => Effect.void,
    listActiveRunsForRecovery: () => Effect.succeed([]),
    markActiveRunInterrupted: () => Effect.void,
  }),
)

const TestProviderLayer = Layer.succeed(ProviderService, {
  get: () => Effect.succeed(undefined),
  getAll: () => Effect.succeed([]),
  getProviderForModel: () => Effect.dieMessage('getProviderForModel is not used'),
  isKnownModel: () => Effect.succeed(true),
})

const TestSettingsLayer = Layer.succeed(SettingsService, {
  get: () => Effect.succeed(DEFAULT_SETTINGS),
  update: () => Effect.void,
  initialize: () => Effect.void,
  flushForTests: () => Effect.void,
})

const TestRuntimeLayer = Layer.mergeAll(
  TestSessionProjectionRepoLayer,
  TestAgentKernelLayer,
  TestSessionRepoLayer,
  TestProviderLayer,
  TestSettingsLayer,
)

import { registerSessionDetailsHandlers } from '../session-details-handler'

function getInvokeHandler(name: string): ((...args: unknown[]) => Promise<unknown>) | undefined {
  const call = typedHandleMock.mock.calls.find(
    (candidate: readonly unknown[]) => candidate[0] === name && typeof candidate[1] === 'function',
  )
  const handler = call?.[1]
  if (typeof handler !== 'function') {
    return undefined
  }

  return (...args: unknown[]) =>
    Effect.runPromise(Effect.provide(handler(...args), TestRuntimeLayer))
}

describe('registerSessionDetailsHandlers', () => {
  beforeEach(() => {
    typedHandleMock.mockReset()
    cleanupSessionRunMock.mockReset()
    createRuntimeSessionMock.mockReset()
    createRuntimeSessionMock.mockResolvedValue({
      piSessionId: 'pi-session-created',
      piSessionFile: '/tmp/pi-session-created.jsonl',
    })
    forkRuntimeSessionMock.mockReset()
    persistSnapshotMock.mockReset()
    listSessionDetailsMock.mockReset()
    getSessionDetailMock.mockReset()
    createSessionMock.mockReset()
    deleteSessionMock.mockReset()
    archiveSessionMock.mockReset()
    unarchiveSessionMock.mockReset()
    listArchivedSessionsMock.mockReset()
    updateSessionTitleMock.mockReset()
  })

  it('registers only session detail IPC channels', () => {
    registerSessionDetailsHandlers()

    const channels = typedHandleMock.mock.calls.map((args: unknown[]) => args[0])
    expect(channels).toEqual([
      'sessions:list-details',
      'sessions:get-detail',
      'sessions:create',
      'sessions:fork-to-new',
      'sessions:clone-to-new',
      'sessions:dismiss-interrupted-run',
      'sessions:delete',
      'sessions:archive',
      'sessions:unarchive',
      'sessions:list-archived',
      'sessions:update-title',
    ])
  })

  it('lists session details through the projection repository', async () => {
    const sessionDetails = [{ id: SessionId('session-1'), title: 'Session', messages: [] }]
    listSessionDetailsMock.mockResolvedValue(sessionDetails)

    registerSessionDetailsHandlers()
    const handler = getInvokeHandler('sessions:list-details')

    const result = await handler?.({}, 10)
    expect(result).toEqual(sessionDetails)
    expect(listSessionDetailsMock).toHaveBeenCalledWith(10)
  })

  it('creates a session with the requested project path', async () => {
    const projectPath = await mkdtemp(path.join(tmpdir(), 'openwaggle-session-test-'))
    const validatedProjectPath = await realpath(projectPath)
    try {
      const createdSession = {
        id: SessionId('session-created'),
        title: 'New session',
        messages: [],
      }
      createSessionMock.mockResolvedValue(createdSession)

      registerSessionDetailsHandlers()
      const handler = getInvokeHandler('sessions:create')

      const result = await handler?.({}, projectPath)
      expect(result).toEqual(createdSession)
      expect(createRuntimeSessionMock).toHaveBeenCalledWith({ projectPath: validatedProjectPath })
      expect(createSessionMock).toHaveBeenCalledWith({
        projectPath: validatedProjectPath,
        piSessionId: 'pi-session-created',
        piSessionFile: '/tmp/pi-session-created.jsonl',
      })
    } finally {
      await rm(projectPath, { recursive: true, force: true })
    }
  })

  it('forks a session from a user message through the Pi kernel and projection repository', async () => {
    const sourceSession = {
      id: SessionId('session-source'),
      title: 'Source',
      projectPath: '/tmp/project',
      messages: [],
      createdAt: 1,
      updatedAt: 2,
    }
    const forkedSession = {
      id: SessionId('pi-session-forked'),
      title: 'Forked',
      projectPath: '/tmp/project',
      messages: [],
      createdAt: 3,
      updatedAt: 4,
    }
    getSessionDetailMock.mockImplementation(async (id: SessionId) =>
      id === SessionId('pi-session-forked') ? forkedSession : sourceSession,
    )
    createSessionMock.mockResolvedValue(forkedSession)
    forkRuntimeSessionMock.mockResolvedValue({
      cancelled: false,
      editorText: 'retry text',
      piSessionId: 'pi-session-forked',
      piSessionFile: '/tmp/pi-session-forked.jsonl',
      sessionSnapshot: { activeNodeId: 'parent-node', nodes: [] },
    })

    registerSessionDetailsHandlers()
    const handler = getInvokeHandler('sessions:fork-to-new')

    const result = await handler?.(
      {},
      SessionId('session-source'),
      SupportedModelId('openai/gpt-5.4'),
      SessionNodeId('user-node'),
    )

    expect(result).toEqual({
      cancelled: false,
      editorText: 'retry text',
      session: forkedSession,
    })
    expect(forkRuntimeSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        targetNodeId: 'user-node',
        position: 'before',
      }),
    )
  })

  it('clones a session from the current node through the Pi kernel', async () => {
    const sourceSession = {
      id: SessionId('session-source'),
      title: 'Source',
      projectPath: '/tmp/project',
      messages: [],
      createdAt: 1,
      updatedAt: 2,
    }
    const clonedSession = {
      id: SessionId('pi-session-cloned'),
      title: 'Cloned',
      projectPath: '/tmp/project',
      messages: [],
      createdAt: 3,
      updatedAt: 4,
    }
    getSessionDetailMock.mockImplementation(async (id: SessionId) =>
      id === SessionId('pi-session-cloned') ? clonedSession : sourceSession,
    )
    createSessionMock.mockResolvedValue(clonedSession)
    forkRuntimeSessionMock.mockResolvedValue({
      cancelled: false,
      piSessionId: 'pi-session-cloned',
      piSessionFile: '/tmp/pi-session-cloned.jsonl',
      sessionSnapshot: { activeNodeId: 'current-node', nodes: [] },
    })

    registerSessionDetailsHandlers()
    const handler = getInvokeHandler('sessions:clone-to-new')

    const result = await handler?.(
      {},
      SessionId('session-source'),
      SupportedModelId('openai/gpt-5.4'),
      SessionNodeId('current-node'),
    )

    expect(result).toEqual({
      cancelled: false,
      session: clonedSession,
    })
    expect(forkRuntimeSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        targetNodeId: 'current-node',
        position: 'at',
      }),
    )
  })

  it('cleans up the active run before deleting a session', async () => {
    deleteSessionMock.mockResolvedValue(undefined)

    registerSessionDetailsHandlers()
    const handler = getInvokeHandler('sessions:delete')

    await handler?.({}, SessionId('session-delete'))

    expect(cleanupSessionRunMock).toHaveBeenCalledWith(SessionId('session-delete'))
    expect(deleteSessionMock).toHaveBeenCalledWith(SessionId('session-delete'))
  })

  it('cleans up the active run before archiving a session', async () => {
    archiveSessionMock.mockResolvedValue(undefined)

    registerSessionDetailsHandlers()
    const handler = getInvokeHandler('sessions:archive')

    await handler?.({}, SessionId('session-archive'))

    expect(cleanupSessionRunMock).toHaveBeenCalledWith(SessionId('session-archive'))
    expect(archiveSessionMock).toHaveBeenCalledWith(SessionId('session-archive'))
  })
})
