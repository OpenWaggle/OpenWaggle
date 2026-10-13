import { MessageId, SessionId } from '@shared/types/brand'
import type { SessionDetail } from '@shared/types/session'
import { DEFAULT_SETTINGS } from '@shared/types/settings'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useComposerStore } from '@/features/composer/state'
import { useSessionStore } from '@/features/sessions/state'
import { usePreferencesStore } from '@/features/settings/state'
import { useChatStore } from '../chat-store'

const mockApi = vi.hoisted(() => ({
  getSessionDetail: vi.fn(),
  getSessionTree: vi.fn(async () => null),
  listSessionCatalogPage: vi.fn(async () => ({ sessions: [] })),
  listPinnedSessions: vi.fn(async () => []),
  listSessionsByIds: vi.fn(async () => []),
  unregisterBrowserPreviewOwner: vi.fn(async () => undefined),
}))

vi.mock('@/shared/lib/ipc', () => ({ api: mockApi }))

/*
 * Selecting a Session shown before shows its cached copy at once, then the Host's, which may
 * differ in what is worked out as it is read, as a deleted Pi file's notice. A reply a newer read
 * or change of the Session overtook is dropped.
 */

const A = SessionId('session-a')
const B = SessionId('session-b')

function detail(
  id: SessionId,
  updatedAt: number,
  messageCount: number,
  extra: Partial<SessionDetail> = {},
): SessionDetail {
  return {
    id,
    title: 'Session',
    projectPath: '/p',
    createdAt: 1,
    updatedAt,
    messages: Array.from({ length: messageCount }, (_, index) => ({
      id: MessageId(`m${index}`),
      role: 'user' as const,
      parts: [],
      createdAt: index,
    })),
    ...extra,
  }
}

function deferred<T>() {
  let resolve: (value: T) => void = () => {}
  const promise = new Promise<T>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

const shown = () => useChatStore.getState().activeSession

describe('Selecting a cached Session', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    usePreferencesStore.setState({ settings: { ...DEFAULT_SETTINGS, projectPath: '/p' } })
    useComposerStore.setState(useComposerStore.getInitialState())
    useChatStore.setState({
      sessions: [],
      sessionById: new Map(),
      missingSessionIds: new Set(),
      draftSession: null,
      activeSessionId: null,
      activeSession: null,
      error: null,
    })
    useSessionStore.setState({ activeSessionTree: null, activeWorkspace: null, draftBranch: null })
  })

  it('shows the notice of a Pi file deleted since it was cached', async () => {
    useChatStore.getState().upsertSession(detail(A, 1, 2))
    mockApi.getSessionDetail.mockResolvedValue(
      detail(A, 1, 2, { piSessionFileDeleted: 'This Session’s Pi file was deleted.' }),
    )

    useChatStore.getState().setActiveSession(A)

    await vi.waitFor(() =>
      expect(shown()?.piSessionFileDeleted).toBe('This Session’s Pi file was deleted.'),
    )
  })

  it('drops the notice once the Pi file is back', async () => {
    useChatStore
      .getState()
      .upsertSession(
        detail(A, 1, 2, { piSessionFileDeleted: 'This Session’s Pi file was deleted.' }),
      )
    mockApi.getSessionDetail.mockResolvedValue(detail(A, 1, 2))

    useChatStore.getState().setActiveSession(A)

    await vi.waitFor(() => expect(shown()?.piSessionFileDeleted).toBeUndefined())
  })

  it('keeps a newer read when the slower reply lands after it', async () => {
    useChatStore.getState().upsertSession(detail(A, 1, 1))
    const slow = deferred<SessionDetail>()
    mockApi.getSessionDetail
      .mockReturnValueOnce(slow.promise)
      .mockResolvedValueOnce(detail(A, 3, 3))

    useChatStore.getState().setActiveSession(A)
    await useChatStore.getState().refreshSession(A)
    slow.resolve(detail(A, 2, 2))
    await vi.waitFor(() => expect(mockApi.getSessionDetail).toHaveBeenCalledTimes(2))
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(shown()).toMatchObject({ updatedAt: 3 })
  })

  it('keeps the reply to its latest selection, from A to B and back', async () => {
    useChatStore.getState().upsertSession(detail(A, 1, 1))
    useChatStore.getState().upsertSession(detail(B, 1, 1))
    const first = deferred<SessionDetail>()
    const last = deferred<SessionDetail>()
    mockApi.getSessionDetail
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce(detail(B, 1, 1))
      .mockReturnValueOnce(last.promise)

    useChatStore.getState().setActiveSession(A)
    useChatStore.getState().setActiveSession(B)
    useChatStore.getState().setActiveSession(A)
    last.resolve(detail(A, 5, 4))
    await vi.waitFor(() => expect(shown()).toMatchObject({ updatedAt: 5 }))
    first.resolve(detail(A, 2, 2))
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(shown()).toMatchObject({ id: A, updatedAt: 5 })
  })

  it('removes a Session the Host no longer has, carrying its draft', async () => {
    useChatStore.getState().upsertSession(detail(A, 1, 0))
    mockApi.getSessionDetail.mockResolvedValue(null)

    useChatStore.getState().setActiveSession(A)
    useComposerStore.getState().setActiveDraftContextKey(`project:/p:session:${String(A)}:main`)
    useComposerStore.getState().setInput('Typed before it went')

    await vi.waitFor(() => expect(useChatStore.getState().missingSessionIds.has(A)).toBe(true))
    expect(useChatStore.getState().activeSessionId).toBeNull()
    expect(useComposerStore.getState().getScopedDraft('project:/p:new-session')?.input).toBe(
      'Typed before it went',
    )
  })

  it('keeps showing the same copy when the Host’s has not changed', async () => {
    const cached = detail(A, 1, 2)
    useChatStore.getState().upsertSession(cached)
    mockApi.getSessionDetail.mockResolvedValue(detail(A, 1, 2))

    useChatStore.getState().setActiveSession(A)
    await vi.waitFor(() => expect(mockApi.getSessionDetail).toHaveBeenCalledTimes(1))
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(shown()).toEqual(cached)
    expect(useChatStore.getState().error).toBeNull()
  })

  it('keeps the cached copy, without an error, when the Host cannot be read', async () => {
    const cached = detail(A, 1, 2)
    useChatStore.getState().upsertSession(cached)
    mockApi.getSessionDetail.mockRejectedValue(new Error('The Session Host is not responding'))

    useChatStore.getState().setActiveSession(A)
    await vi.waitFor(() => expect(mockApi.getSessionDetail).toHaveBeenCalledTimes(1))
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(shown()).toBe(cached)
    expect(useChatStore.getState().error).toBeNull()
  })

  it('keeps a title written while the Host’s copy was read', async () => {
    useChatStore.getState().upsertSession(detail(A, 1, 2, { title: 'Old title' }))
    const slow = deferred<SessionDetail>()
    mockApi.getSessionDetail.mockReturnValueOnce(slow.promise)

    useChatStore.getState().setActiveSession(A)
    // A rename, or a generated title; neither changes the Session's time.
    useChatStore.getState().applySessionTitle(A, 'New title')
    slow.resolve(detail(A, 1, 2, { title: 'Old title' }))
    await vi.waitFor(() => expect(mockApi.getSessionDetail).toHaveBeenCalledTimes(1))
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(shown()?.title).toBe('New title')
  })
})
