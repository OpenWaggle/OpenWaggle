import { ConversationId } from '@shared/types/brand'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { apiMock } = vi.hoisted(() => ({
  apiMock: {
    listConversations: vi.fn(),
    createConversation: vi.fn(),
    getConversation: vi.fn(),
    deleteConversation: vi.fn(),
    updateConversationProjectPath: vi.fn(),
  },
}))

vi.mock('@/lib/ipc', () => ({
  api: apiMock,
}))

import { useChatStore } from '../chat-store'

describe('useChatStore integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useChatStore.setState({
      conversations: [],
      activeConversationId: null,
      activeConversation: null,
    })
  })

  it('loads conversations into state', async () => {
    const list = [
      {
        id: ConversationId('conv-1'),
        title: 'Thread 1',
        projectPath: null,
        messageCount: 0,
        createdAt: 1,
        updatedAt: 2,
      },
    ]
    apiMock.listConversations.mockResolvedValue(list)

    await useChatStore.getState().loadConversations()

    expect(useChatStore.getState().conversations).toEqual(list)
    expect(apiMock.listConversations).toHaveBeenCalledOnce()
  })

  it('creates a conversation and marks it active', async () => {
    const created = {
      id: ConversationId('conv-2'),
      title: 'New thread',
      projectPath: '/tmp/repo',
      messages: [],
      createdAt: 10,
      updatedAt: 10,
    }
    apiMock.createConversation.mockResolvedValue(created)
    apiMock.listConversations.mockResolvedValue([
      {
        id: created.id,
        title: created.title,
        projectPath: created.projectPath,
        messageCount: 0,
        createdAt: 10,
        updatedAt: 10,
      },
    ])

    const id = await useChatStore.getState().createConversation('/tmp/repo')

    expect(id).toBe(created.id)
    expect(useChatStore.getState().activeConversationId).toBe(created.id)
    expect(useChatStore.getState().activeConversation).toEqual(created)
  })

  it('loads a selected conversation and clears when null is selected', async () => {
    const id = ConversationId('conv-3')
    const conversation = {
      id,
      title: 'Loaded thread',
      projectPath: null,
      messages: [],
      createdAt: 20,
      updatedAt: 20,
    }
    apiMock.getConversation.mockResolvedValue(conversation)

    await useChatStore.getState().setActiveConversation(id)
    expect(useChatStore.getState().activeConversation).toEqual(conversation)

    await useChatStore.getState().setActiveConversation(null)
    expect(useChatStore.getState().activeConversationId).toBeNull()
    expect(useChatStore.getState().activeConversation).toBeNull()
  })

  it('deletes active conversation and resets selection', async () => {
    const id = ConversationId('conv-4')
    useChatStore.setState({
      conversations: [],
      activeConversationId: id,
      activeConversation: {
        id,
        title: 'To delete',
        projectPath: null,
        messages: [],
        createdAt: 30,
        updatedAt: 30,
      },
    })

    apiMock.deleteConversation.mockResolvedValue(undefined)
    apiMock.listConversations.mockResolvedValue([])

    await useChatStore.getState().deleteConversation(id)

    expect(apiMock.deleteConversation).toHaveBeenCalledWith(id)
    expect(useChatStore.getState().activeConversationId).toBeNull()
    expect(useChatStore.getState().activeConversation).toBeNull()
  })

  it('updates active conversation project path and reloads summaries', async () => {
    const id = ConversationId('conv-5')
    useChatStore.setState({
      conversations: [
        {
          id,
          title: 'Thread',
          projectPath: '/tmp/old',
          messageCount: 0,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      activeConversationId: id,
      activeConversation: {
        id,
        title: 'Thread',
        projectPath: '/tmp/old',
        messages: [],
        createdAt: 1,
        updatedAt: 1,
      },
    })

    apiMock.updateConversationProjectPath.mockResolvedValue({
      id,
      title: 'Thread',
      projectPath: '/tmp/new',
      messages: [],
      createdAt: 1,
      updatedAt: 2,
    })
    apiMock.listConversations.mockResolvedValue([
      {
        id,
        title: 'Thread',
        projectPath: '/tmp/new',
        messageCount: 0,
        createdAt: 1,
        updatedAt: 2,
      },
    ])

    await useChatStore.getState().updateConversationProjectPath(id, '/tmp/new')

    expect(apiMock.updateConversationProjectPath).toHaveBeenCalledWith(id, '/tmp/new')
    expect(useChatStore.getState().activeConversation?.projectPath).toBe('/tmp/new')
    expect(useChatStore.getState().conversations[0]?.projectPath).toBe('/tmp/new')
  })
})
