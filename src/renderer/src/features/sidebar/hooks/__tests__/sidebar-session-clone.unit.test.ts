import { SessionId, SessionNodeId, SupportedModelId } from '@shared/types/brand'
import type { ProviderInfo } from '@shared/types/llm'
import type { SessionDetail } from '@shared/types/session'
import { fromPartial } from '@total-typescript/shoehorn'
import { expect, it, vi } from 'vitest'

const apiMock = vi.hoisted(() => ({ cloneSessionToNew: vi.fn(async () => ({ cancelled: true })) }))
vi.mock('@/shared/lib/ipc', () => ({ api: apiMock }))

import { useChatStore } from '@/features/chat/state'
import { useProviderStore } from '@/features/providers/state'
import { useSessionStore } from '@/features/sessions/state'
import { createSidebarSessionActions } from '../sidebar-session-actions'

const SESSION_ID = SessionId('session-gone-model')
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
