import { SessionId, SessionNodeId, SupportedModelId } from '@shared/types/brand'
import type { ProviderInfo } from '@shared/types/llm'
import type { SessionDetail } from '@shared/types/session'
import { fromPartial } from '@total-typescript/shoehorn'
import { beforeEach, expect, it, vi } from 'vitest'

const apiMock = vi.hoisted(() => ({
  cloneSessionToNew: vi.fn(async () => ({ cancelled: true })),
  getSessionWorkspace: vi.fn(),
}))
vi.mock('@/shared/lib/ipc', () => ({ api: apiMock }))

import { useChatStore } from '@/features/chat/state'
import { useProviderStore } from '@/features/providers/state'
import { useSessionStore } from '@/features/sessions/state'
import { createSidebarSessionActions } from '../sidebar-session-actions'

const SESSION_ID = SessionId('session-gone-model')
const OTHER_SESSION_ID = SessionId('session-not-open')

beforeEach(() => {
  apiMock.cloneSessionToNew.mockClear()
  apiMock.getSessionWorkspace.mockReset()
})
const GONE = SupportedModelId('router/removed-auto')
const MINI = SupportedModelId('openai/gpt-4.1-mini')

it('clones a Session whose model is gone, so the Host falls back to the model that answered last', async () => {
  useProviderStore.setState({
    providerModels: [
      fromPartial<ProviderInfo>({
        provider: 'openai',
        models: [fromPartial({ id: MINI, name: 'GPT 4.1 mini', available: true })],
      }),
    ],
    catalogHydrated: true,
  })
  useChatStore.setState({
    activeSessionId: SESSION_ID,
    sessionById: new Map([
      [
        SESSION_ID,
        fromPartial<SessionDetail>({
          id: SESSION_ID,
          messages: [fromPartial({ role: 'assistant', model: MINI })],
        }),
      ],
    ]),
  })
  useSessionStore.setState({
    draftBranch: fromPartial({ sessionId: SESSION_ID, sourceNodeId: SessionNodeId('head') }),
  })
  const showToast = vi.fn()

  createSidebarSessionActions(
    fromPartial({ activeSessionId: SESSION_ID, selectedModel: GONE, showToast }),
  ).clone(SESSION_ID)

  await vi.waitFor(() =>
    expect(apiMock.cloneSessionToNew).toHaveBeenCalledWith(SESSION_ID, GONE, SessionNodeId('head')),
  )
  expect(showToast).not.toHaveBeenCalledWith('Select a model before cloning.')
})

it('clones a Session that is not open from its current conversation on the Host', async () => {
  useChatStore.setState({ activeSessionId: SESSION_ID })
  useSessionStore.setState({ draftBranch: null })
  apiMock.getSessionWorkspace.mockResolvedValue(
    fromPartial({
      tree: { session: { id: OTHER_SESSION_ID }, branches: [] },
      activeBranchId: null,
      activeNodeId: SessionNodeId('other-head'),
    }),
  )
  const showToast = vi.fn()

  createSidebarSessionActions(
    fromPartial({ activeSessionId: SESSION_ID, selectedModel: MINI, showToast }),
  ).clone(OTHER_SESSION_ID)

  await vi.waitFor(() =>
    expect(apiMock.cloneSessionToNew).toHaveBeenCalledWith(
      OTHER_SESSION_ID,
      MINI,
      SessionNodeId('other-head'),
    ),
  )
  expect(showToast).not.toHaveBeenCalledWith('Open this session before cloning it.')
})

it('makes one clone however often Clone is chosen while the first is on its way', async () => {
  useChatStore.setState({ activeSessionId: SESSION_ID })
  useSessionStore.setState({
    draftBranch: fromPartial({ sessionId: SESSION_ID, sourceNodeId: SessionNodeId('head') }),
  })
  let finish: (value: { cancelled: true }) => void = () => undefined
  apiMock.cloneSessionToNew.mockImplementationOnce(
    () => new Promise((resolve) => (finish = resolve)),
  )
  const actions = createSidebarSessionActions(
    fromPartial({ activeSessionId: SESSION_ID, selectedModel: MINI, showToast: vi.fn() }),
  )

  actions.clone(SESSION_ID)
  await vi.waitFor(() => expect(apiMock.cloneSessionToNew).toHaveBeenCalledTimes(1))
  actions.clone(SESSION_ID)
  actions.clone(SESSION_ID)
  finish({ cancelled: true })
  await new Promise((resolve) => setTimeout(resolve, 0))

  expect(apiMock.cloneSessionToNew).toHaveBeenCalledTimes(1)
})

it("clones a Session that is not open from the Host, ignoring the open Session's draft branch", async () => {
  useChatStore.setState({ activeSessionId: SESSION_ID })
  useSessionStore.setState({
    draftBranch: fromPartial({ sessionId: SESSION_ID, sourceNodeId: SessionNodeId('open-draft') }),
  })
  apiMock.getSessionWorkspace.mockResolvedValue(
    fromPartial({
      tree: { session: { id: OTHER_SESSION_ID }, branches: [] },
      activeBranchId: null,
      activeNodeId: SessionNodeId('other-head'),
    }),
  )

  createSidebarSessionActions(
    fromPartial({ activeSessionId: SESSION_ID, selectedModel: MINI, showToast: vi.fn() }),
  ).clone(OTHER_SESSION_ID)

  await vi.waitFor(() =>
    expect(apiMock.cloneSessionToNew).toHaveBeenCalledWith(
      OTHER_SESSION_ID,
      MINI,
      SessionNodeId('other-head'),
    ),
  )
})

it("reports a failed read of a closed Session's conversation as the clone's failure", async () => {
  useChatStore.setState({ activeSessionId: SESSION_ID })
  useSessionStore.setState({ draftBranch: null })
  apiMock.getSessionWorkspace.mockRejectedValue(new Error('Host unavailable'))
  const showToast = vi.fn()

  createSidebarSessionActions(
    fromPartial({ activeSessionId: SESSION_ID, selectedModel: MINI, showToast }),
  ).clone(OTHER_SESSION_ID)

  await vi.waitFor(() =>
    expect(showToast).toHaveBeenCalledWith('Failed to clone session: Host unavailable'),
  )
  expect(apiMock.cloneSessionToNew).not.toHaveBeenCalled()
})
