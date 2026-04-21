import { ConversationId } from '@shared/types/brand'
import { Layer } from 'effect'
import * as Effect from 'effect/Effect'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ConversationRepositoryError } from '../../errors'
import { ConversationRepository } from '../../ports/conversation-repository'

const {
  typedHandleMock,
  cleanupConversationRunMock,
  listConversationsMock,
  listFullConversationsMock,
  getConversationMock,
  createConversationMock,
  deleteConversationMock,
  archiveConversationMock,
  unarchiveConversationMock,
  listArchivedConversationsMock,
  updateConversationTitleMock,
  updateConversationProjectPathMock,
  updateConversationPlanModeMock,
} = vi.hoisted(() => ({
  typedHandleMock: vi.fn(),
  cleanupConversationRunMock: vi.fn(),
  listConversationsMock: vi.fn(),
  listFullConversationsMock: vi.fn(),
  getConversationMock: vi.fn(),
  createConversationMock: vi.fn(),
  deleteConversationMock: vi.fn(),
  archiveConversationMock: vi.fn(),
  unarchiveConversationMock: vi.fn(),
  listArchivedConversationsMock: vi.fn(),
  updateConversationTitleMock: vi.fn(),
  updateConversationProjectPathMock: vi.fn(),
  updateConversationPlanModeMock: vi.fn(),
}))

vi.mock('../typed-ipc', () => ({
  typedHandle: typedHandleMock,
}))

vi.mock('../../agent/conversation-cleanup', () => ({
  cleanupConversationRun: cleanupConversationRunMock,
}))

const TestConversationRepoLayer = Layer.succeed(
  ConversationRepository,
  ConversationRepository.of({
    get: (id) =>
      Effect.tryPromise({
        try: async () => getConversationMock(id),
        catch: (cause) => new ConversationRepositoryError({ operation: 'get', cause }),
      }),
    save: () => Effect.void,
    list: (limit) =>
      Effect.tryPromise({
        try: async () => listConversationsMock(limit),
        catch: (cause) => new ConversationRepositoryError({ operation: 'list', cause }),
      }),
    listFull: (limit) =>
      Effect.tryPromise({
        try: async () => listFullConversationsMock(limit),
        catch: (cause) => new ConversationRepositoryError({ operation: 'listFull', cause }),
      }),
    create: (projectPath) =>
      Effect.tryPromise({
        try: async () => createConversationMock(projectPath),
        catch: (cause) => new ConversationRepositoryError({ operation: 'create', cause }),
      }),
    delete: (id) =>
      Effect.tryPromise({
        try: async () => {
          await deleteConversationMock(id)
        },
        catch: (cause) => new ConversationRepositoryError({ operation: 'delete', cause }),
      }),
    archive: (id) =>
      Effect.tryPromise({
        try: async () => {
          await archiveConversationMock(id)
        },
        catch: (cause) => new ConversationRepositoryError({ operation: 'archive', cause }),
      }),
    unarchive: (id) =>
      Effect.tryPromise({
        try: async () => {
          await unarchiveConversationMock(id)
        },
        catch: (cause) => new ConversationRepositoryError({ operation: 'unarchive', cause }),
      }),
    listArchived: () =>
      Effect.tryPromise({
        try: async () => listArchivedConversationsMock(),
        catch: (cause) => new ConversationRepositoryError({ operation: 'listArchived', cause }),
      }),
    updateTitle: (id, title) =>
      Effect.tryPromise({
        try: async () => {
          await updateConversationTitleMock(id, title)
        },
        catch: (cause) => new ConversationRepositoryError({ operation: 'updateTitle', cause }),
      }),
    updateProjectPath: (id, projectPath) =>
      Effect.tryPromise({
        try: async () => {
          await updateConversationProjectPathMock(id, projectPath)
        },
        catch: (cause) =>
          new ConversationRepositoryError({ operation: 'updateProjectPath', cause }),
      }),
    updatePlanMode: (id, active) =>
      Effect.tryPromise({
        try: async () => {
          await updateConversationPlanModeMock(id, active)
        },
        catch: (cause) => new ConversationRepositoryError({ operation: 'updatePlanMode', cause }),
      }),
    updateCompactionGuidance: () => Effect.void,
    markMessagesAsCompacted: () => Effect.void,
  }),
)

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
    Effect.runPromise(Effect.provide(handler(...args), TestConversationRepoLayer))
}

describe('registerConversationsHandlers', () => {
  beforeEach(() => {
    typedHandleMock.mockReset()
    cleanupConversationRunMock.mockReset()
    listConversationsMock.mockReset()
    listFullConversationsMock.mockReset()
    getConversationMock.mockReset()
    createConversationMock.mockReset()
    deleteConversationMock.mockReset()
    archiveConversationMock.mockReset()
    unarchiveConversationMock.mockReset()
    listArchivedConversationsMock.mockReset()
    updateConversationTitleMock.mockReset()
    updateConversationProjectPathMock.mockReset()
    updateConversationPlanModeMock.mockReset()
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
    expect(channels).toContain('conversations:update-project-path')
  })

  it('lists conversations through the repository', async () => {
    const summaries = [{ id: ConversationId('conv-1'), title: 'Thread' }]
    listConversationsMock.mockResolvedValue(summaries)

    registerConversationsHandlers()
    const handler = getInvokeHandler('conversations:list')

    const result = await handler?.({}, 10)
    expect(result).toEqual(summaries)
    expect(listConversationsMock).toHaveBeenCalledWith(10)
  })

  it('lists full conversations through the repository', async () => {
    const conversations = [{ id: ConversationId('conv-1'), title: 'Thread', messages: [] }]
    listFullConversationsMock.mockResolvedValue(conversations)

    registerConversationsHandlers()
    const handler = getInvokeHandler('conversations:list-full')

    const result = await handler?.({}, 10)
    expect(result).toEqual(conversations)
    expect(listFullConversationsMock).toHaveBeenCalledWith(10)
  })

  it('creates a conversation with the requested project path', async () => {
    const createdConversation = { id: ConversationId('conv-created'), title: 'New thread' }
    createConversationMock.mockResolvedValue(createdConversation)

    registerConversationsHandlers()
    const handler = getInvokeHandler('conversations:create')

    const result = await handler?.({}, '/tmp/project')
    expect(result).toEqual(createdConversation)
    expect(createConversationMock).toHaveBeenCalledWith('/tmp/project')
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

  it('updates the conversation project path through the repository', async () => {
    const updatedConversation = { id: ConversationId('conv-update'), projectPath: '/tmp/next' }
    getConversationMock.mockResolvedValue(updatedConversation)

    registerConversationsHandlers()
    const handler = getInvokeHandler('conversations:update-project-path')

    const result = await handler?.({}, ConversationId('conv-update'), '/tmp/next')
    expect(result).toEqual(updatedConversation)
    expect(updateConversationProjectPathMock).toHaveBeenCalledWith(
      ConversationId('conv-update'),
      '/tmp/next',
    )
  })
})
