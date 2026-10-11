import { SessionBranchId, SessionId, SessionNodeId, SupportedModelId } from '@shared/types/brand'
import type { ProviderInfo } from '@shared/types/llm'
import type { SessionBranch, SessionDetail } from '@shared/types/session'
import { fromPartial } from '@total-typescript/shoehorn'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const apiMock = vi.hoisted(() => ({
  navigateSessionTree: vi.fn(async () => undefined),
  getSessionDetail: vi.fn(async (): Promise<SessionDetail | null> => null),
}))

vi.mock('@/shared/lib/ipc', () => ({ api: apiMock }))

import { useChatStore } from '@/features/chat/state'
import { useProviderStore } from '@/features/providers/state'
import { createSidebarBranchActions } from '../sidebar-branch-actions'

const SESSION_ID = SessionId('session-gone-model')
const GONE = SupportedModelId('router/removed-auto')
const MINI = SupportedModelId('openai/gpt-4.1-mini')

const OPENAI: ProviderInfo = fromPartial<ProviderInfo>({
  provider: 'openai',
  displayName: 'OpenAI',
  models: [fromPartial({ id: MINI, name: 'GPT 4.1 mini', provider: 'openai', available: true })],
})

function sessionAnsweredBy(model: SupportedModelId | undefined) {
  return fromPartial<SessionDetail>({
    id: SESSION_ID,
    executionModel: GONE,
    messages: model ? [fromPartial({ role: 'assistant', model })] : [],
  })
}

describe('switching the branch of a Session whose model is gone', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useChatStore.setState({ activeSession: null, activeSessionId: null })
    useProviderStore.setState({ providerModels: [OPENAI], catalogHydrated: true })
  })

  function switchBranch(session: SessionDetail, options: { readonly cached?: boolean } = {}) {
    useChatStore.setState({
      sessionById: new Map(options.cached === false ? [] : [[SESSION_ID, session]]),
    })
    apiMock.getSessionDetail.mockResolvedValue(session)
    const showToast = vi.fn()
    const actions = createSidebarBranchActions(
      fromPartial({
        activeSessionId: SESSION_ID,
        clearDraftBranchForSession: vi.fn(),
        navigate: vi.fn(),
        refreshSessionWorkspace: vi.fn(async () => undefined),
        defaultModel: MINI,
        showToast,
      }),
    )
    actions.select(
      String(SESSION_ID),
      fromPartial<SessionBranch>({
        id: SessionBranchId(`${SESSION_ID}:branch:b`),
        headNodeId: SessionNodeId('head-b'),
      }),
    )
    return showToast
  }

  it('switches, so the Host falls back to the model that answered last', async () => {
    const showToast = switchBranch(sessionAnsweredBy(MINI))

    await vi.waitFor(() => expect(apiMock.navigateSessionTree).toHaveBeenCalled())
    expect(showToast).not.toHaveBeenCalled()
  })

  it('says plainly why a Session whose Pi file cannot be used does not switch branch', async () => {
    const reason =
      "This Session's Pi session file was deleted (/p/s.jsonl). Send a message to start a new transcript before going to another branch in it."
    apiMock.navigateSessionTree.mockRejectedValueOnce(
      new Error(`Error invoking remote method 'sessions:navigate-tree': Error: ${reason}`),
    )

    const showToast = switchBranch(sessionAnsweredBy(MINI))

    await vi.waitFor(() => expect(showToast).toHaveBeenCalledWith(reason))
  })

  it('refuses when nothing the Session could fall back to has answered', async () => {
    const showToast = switchBranch(sessionAnsweredBy(undefined))

    await vi.waitFor(() =>
      expect(showToast).toHaveBeenCalledWith('Select a model before switching branches.'),
    )
    expect(apiMock.navigateSessionTree).not.toHaveBeenCalled()
  })

  it('switches a Session the chat store has not loaded, using the detail it fetched', async () => {
    const showToast = switchBranch(sessionAnsweredBy(MINI), { cached: false })

    await vi.waitFor(() => expect(apiMock.navigateSessionTree).toHaveBeenCalled())
    expect(showToast).not.toHaveBeenCalled()
  })
})
