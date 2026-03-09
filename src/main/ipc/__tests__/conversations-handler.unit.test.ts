import { ConversationId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  typedHandleEffectMock,
  cleanupConversationRunMock,
  listConversationsMock,
  getConversationMock,
  createConversationMock,
  deleteConversationMock,
  archiveConversationMock,
  unarchiveConversationMock,
  listArchivedConversationsMock,
  updateConversationTitleMock,
  updateConversationProjectPathMock,
} = vi.hoisted(() => ({
  typedHandleEffectMock: vi.fn(),
  cleanupConversationRunMock: vi.fn(),
  listConversationsMock: vi.fn(),
  getConversationMock: vi.fn(),
  createConversationMock: vi.fn(),
  deleteConversationMock: vi.fn(),
  archiveConversationMock: vi.fn(),
  unarchiveConversationMock: vi.fn(),
  listArchivedConversationsMock: vi.fn(),
  updateConversationTitleMock: vi.fn(),
  updateConversationProjectPathMock: vi.fn(),
}))

vi.mock('../typed-ipc', () => ({
  typedHandleEffect: typedHandleEffectMock,
}))

vi.mock('../../agent/conversation-cleanup', () => ({
  cleanupConversationRun: cleanupConversationRunMock,
}))

vi.mock('../../store/conversations', () => ({
  listConversations: listConversationsMock,
  getConversation: getConversationMock,
  createConversation: createConversationMock,
  deleteConversation: deleteConversationMock,
  archiveConversation: archiveConversationMock,
  unarchiveConversation: unarchiveConversationMock,
  listArchivedConversations: listArchivedConversationsMock,
  updateConversationTitle: updateConversationTitleMock,
  updateConversationProjectPath: updateConversationProjectPathMock,
}))

import { registerConversationsHandlers } from '../conversations-handler'

function getInvokeHandler(name: string): ((...args: unknown[]) => Promise<unknown>) | undefined {
  const call = typedHandleEffectMock.mock.calls.find(
    (candidate: readonly unknown[]) => candidate[0] === name && typeof candidate[1] === 'function',
  )
  const handler = call?.[1]
  if (typeof handler !== 'function') {
    return undefined
  }

  return (...args: unknown[]) => Effect.runPromise(handler(...args))
}

describe('registerConversationsHandlers', () => {
  beforeEach(() => {
    typedHandleEffectMock.mockReset()
    cleanupConversationRunMock.mockReset()
    listConversationsMock.mockReset()
    getConversationMock.mockReset()
    createConversationMock.mockReset()
    deleteConversationMock.mockReset()
    archiveConversationMock.mockReset()
    unarchiveConversationMock.mockReset()
    listArchivedConversationsMock.mockReset()
    updateConversationTitleMock.mockReset()
    updateConversationProjectPathMock.mockReset()
  })

  it('registers all expected IPC channels', () => {
    registerConversationsHandlers()

    const channels = typedHandleEffectMock.mock.calls.map((args: unknown[]) => args[0])
    expect(channels).toContain('conversations:list')
    expect(channels).toContain('conversations:get')
    expect(channels).toContain('conversations:create')
    expect(channels).toContain('conversations:delete')
    expect(channels).toContain('conversations:archive')
    expect(channels).toContain('conversations:unarchive')
    expect(channels).toContain('conversations:list-archived')
    expect(channels).toContain('conversations:update-title')
    expect(channels).toContain('conversations:update-project-path')
  })

  it('lists conversations through the store', async () => {
    const summaries = [{ id: ConversationId('conv-1'), title: 'Thread' }]
    listConversationsMock.mockResolvedValue(summaries)

    registerConversationsHandlers()
    const handler = getInvokeHandler('conversations:list')

    const result = await handler?.({}, 10)
    expect(result).toEqual(summaries)
    expect(listConversationsMock).toHaveBeenCalledWith(10)
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
    expect(cleanupConversationRunMock.mock.invocationCallOrder[0]).toBeLessThan(
      deleteConversationMock.mock.invocationCallOrder[0],
    )
  })

  it('cleans up the active run before archiving a conversation', async () => {
    archiveConversationMock.mockResolvedValue(undefined)

    registerConversationsHandlers()
    const handler = getInvokeHandler('conversations:archive')

    await handler?.({}, ConversationId('conv-archive'))

    expect(cleanupConversationRunMock).toHaveBeenCalledWith(ConversationId('conv-archive'))
    expect(archiveConversationMock).toHaveBeenCalledWith(ConversationId('conv-archive'))
    expect(cleanupConversationRunMock.mock.invocationCallOrder[0]).toBeLessThan(
      archiveConversationMock.mock.invocationCallOrder[0],
    )
  })

  it('updates the conversation project path through the store', async () => {
    const updatedConversation = { id: ConversationId('conv-update'), projectPath: '/tmp/next' }
    updateConversationProjectPathMock.mockResolvedValue(updatedConversation)

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
