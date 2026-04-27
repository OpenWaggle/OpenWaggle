import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { ConversationId } from '@shared/types/brand'
import { Layer } from 'effect'
import * as Effect from 'effect/Effect'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionProjectionRepositoryError } from '../../errors'
import { AgentKernelService } from '../../ports/agent-kernel-service'
import { SessionProjectionRepository } from '../../ports/session-projection-repository'

const {
  typedHandleMock,
  cleanupConversationRunMock,
  createRuntimeSessionMock,
  listConversationsMock,
  listFullConversationsMock,
  getConversationMock,
  createConversationMock,
  deleteConversationMock,
  archiveConversationMock,
  unarchiveConversationMock,
  listArchivedConversationsMock,
  updateConversationTitleMock,
} = vi.hoisted(() => ({
  typedHandleMock: vi.fn(),
  cleanupConversationRunMock: vi.fn(),
  createRuntimeSessionMock: vi.fn(async (_input: { readonly projectPath: string }) => ({
    piSessionId: 'pi-session-created',
    piSessionFile: '/tmp/pi-session-created.jsonl',
  })),
  listConversationsMock: vi.fn(),
  listFullConversationsMock: vi.fn(),
  getConversationMock: vi.fn(),
  createConversationMock: vi.fn(),
  deleteConversationMock: vi.fn(),
  archiveConversationMock: vi.fn(),
  unarchiveConversationMock: vi.fn(),
  listArchivedConversationsMock: vi.fn(),
  updateConversationTitleMock: vi.fn(),
}))

vi.mock('../typed-ipc', () => ({
  typedHandle: typedHandleMock,
}))

vi.mock('../../agent/conversation-cleanup', () => ({
  cleanupConversationRun: cleanupConversationRunMock,
}))

const TestConversationRepoLayer = Layer.succeed(
  SessionProjectionRepository,
  SessionProjectionRepository.of({
    get: (id) =>
      Effect.tryPromise({
        try: async () => getConversationMock(id),
        catch: (cause) => new SessionProjectionRepositoryError({ operation: 'get', cause }),
      }),
    getOptional: (id) =>
      Effect.tryPromise({
        try: async () => getConversationMock(id),
        catch: (cause) => new SessionProjectionRepositoryError({ operation: 'getOptional', cause }),
      }),
    list: (limit) =>
      Effect.tryPromise({
        try: async () => listConversationsMock(limit),
        catch: (cause) => new SessionProjectionRepositoryError({ operation: 'list', cause }),
      }),
    listFull: (limit) =>
      Effect.tryPromise({
        try: async () => listFullConversationsMock(limit),
        catch: (cause) => new SessionProjectionRepositoryError({ operation: 'listFull', cause }),
      }),
    create: (input) =>
      Effect.tryPromise({
        try: async () => createConversationMock(input),
        catch: (cause) => new SessionProjectionRepositoryError({ operation: 'create', cause }),
      }),
    delete: (id) =>
      Effect.tryPromise({
        try: async () => {
          await deleteConversationMock(id)
        },
        catch: (cause) => new SessionProjectionRepositoryError({ operation: 'delete', cause }),
      }),
    archive: (id) =>
      Effect.tryPromise({
        try: async () => {
          await archiveConversationMock(id)
        },
        catch: (cause) => new SessionProjectionRepositoryError({ operation: 'archive', cause }),
      }),
    unarchive: (id) =>
      Effect.tryPromise({
        try: async () => {
          await unarchiveConversationMock(id)
        },
        catch: (cause) => new SessionProjectionRepositoryError({ operation: 'unarchive', cause }),
      }),
    listArchived: () =>
      Effect.tryPromise({
        try: async () => listArchivedConversationsMock(),
        catch: (cause) =>
          new SessionProjectionRepositoryError({ operation: 'listArchived', cause }),
      }),
    updateTitle: (id, title) =>
      Effect.tryPromise({
        try: async () => {
          await updateConversationTitleMock(id, title)
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
    run: () => Effect.fail(new Error('agent run not used by conversations handler tests')),
    runWaggleTurn: () =>
      Effect.fail(new Error('Waggle turn not used by conversations handler tests')),
    getContextUsage: () =>
      Effect.fail(new Error('context usage not used by conversations handler tests')),
    compact: () => Effect.fail(new Error('compaction not used by conversations handler tests')),
    navigateTree: () =>
      Effect.fail(new Error('tree navigation not used by conversations handler tests')),
  }),
)

const TestRuntimeLayer = Layer.merge(TestConversationRepoLayer, TestAgentKernelLayer)

import { registerConversationsHandlers } from '../conversations-handler'

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

describe('registerConversationsHandlers', () => {
  beforeEach(() => {
    typedHandleMock.mockReset()
    cleanupConversationRunMock.mockReset()
    createRuntimeSessionMock.mockReset()
    createRuntimeSessionMock.mockResolvedValue({
      piSessionId: 'pi-session-created',
      piSessionFile: '/tmp/pi-session-created.jsonl',
    })
    listConversationsMock.mockReset()
    listFullConversationsMock.mockReset()
    getConversationMock.mockReset()
    createConversationMock.mockReset()
    deleteConversationMock.mockReset()
    archiveConversationMock.mockReset()
    unarchiveConversationMock.mockReset()
    listArchivedConversationsMock.mockReset()
    updateConversationTitleMock.mockReset()
  })

  it('registers all expected IPC channels', () => {
    registerConversationsHandlers()

    const channels = typedHandleMock.mock.calls.map((args: unknown[]) => args[0])
    expect(channels).toContain('conversations:list')
    expect(channels).toContain('conversations:list-full')
    expect(channels).toContain('conversations:get')
    expect(channels).toContain('conversations:create')
    expect(channels).toContain('conversations:delete')
    expect(channels).toContain('conversations:archive')
    expect(channels).toContain('conversations:unarchive')
    expect(channels).toContain('conversations:list-archived')
    expect(channels).toContain('conversations:update-title')
  })

  it('lists conversations through the repository', async () => {
    const summaries = [{ id: ConversationId('conv-1'), title: 'Session' }]
    listConversationsMock.mockResolvedValue(summaries)

    registerConversationsHandlers()
    const handler = getInvokeHandler('conversations:list')

    const result = await handler?.({}, 10)
    expect(result).toEqual(summaries)
    expect(listConversationsMock).toHaveBeenCalledWith(10)
  })

  it('lists full conversations through the repository', async () => {
    const conversations = [{ id: ConversationId('conv-1'), title: 'Session', messages: [] }]
    listFullConversationsMock.mockResolvedValue(conversations)

    registerConversationsHandlers()
    const handler = getInvokeHandler('conversations:list-full')

    const result = await handler?.({}, 10)
    expect(result).toEqual(conversations)
    expect(listFullConversationsMock).toHaveBeenCalledWith(10)
  })

  it('creates a conversation with the requested project path', async () => {
    const projectPath = await mkdtemp(path.join(tmpdir(), 'openwaggle-conversation-test-'))
    const validatedProjectPath = await realpath(projectPath)
    try {
      const createdConversation = { id: ConversationId('conv-created'), title: 'New session' }
      createConversationMock.mockResolvedValue(createdConversation)

      registerConversationsHandlers()
      const handler = getInvokeHandler('conversations:create')

      const result = await handler?.({}, projectPath)
      expect(result).toEqual(createdConversation)
      expect(createRuntimeSessionMock).toHaveBeenCalledWith({ projectPath: validatedProjectPath })
      expect(createConversationMock).toHaveBeenCalledWith({
        projectPath: validatedProjectPath,
        piSessionId: 'pi-session-created',
        piSessionFile: '/tmp/pi-session-created.jsonl',
      })
    } finally {
      await rm(projectPath, { recursive: true, force: true })
    }
  })

  it('cleans up the active run before deleting a conversation', async () => {
    deleteConversationMock.mockResolvedValue(undefined)

    registerConversationsHandlers()
    const handler = getInvokeHandler('conversations:delete')

    await handler?.({}, ConversationId('conv-delete'))

    expect(cleanupConversationRunMock).toHaveBeenCalledWith(ConversationId('conv-delete'))
    expect(deleteConversationMock).toHaveBeenCalledWith(ConversationId('conv-delete'))
  })

  it('cleans up the active run before archiving a conversation', async () => {
    archiveConversationMock.mockResolvedValue(undefined)

    registerConversationsHandlers()
    const handler = getInvokeHandler('conversations:archive')

    await handler?.({}, ConversationId('conv-archive'))

    expect(cleanupConversationRunMock).toHaveBeenCalledWith(ConversationId('conv-archive'))
    expect(archiveConversationMock).toHaveBeenCalledWith(ConversationId('conv-archive'))
  })
})
