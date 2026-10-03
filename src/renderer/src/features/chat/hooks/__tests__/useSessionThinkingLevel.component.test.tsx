import { SessionId } from '@shared/types/brand'
import { act, waitFor } from '@testing-library/react'
import { fromPartial } from '@total-typescript/shoehorn'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useBackgroundRunStore, useChatStore } from '@/features/chat/state'
import { useFirstSendPendingStore } from '@/features/chat/state/first-send-pending-store'
import {
  resetForegroundSendsForTests,
  useForegroundSendStore,
} from '@/features/chat/state/foreground-send-store'
import {
  resetThinkingLevelWritesForTests,
  settledThinkingLevelWrites,
} from '@/features/chat/state/session-thinking-level-writes'
import { createRendererQueryClient } from '@/queries/query-client'
import { renderHookWithQueryClient } from '@/test-utils/query-test-utils'
import {
  defaultThinkingLevelQueryOptions,
  invalidateDefaultThinkingLevel,
  SessionThinkingLevelRefusedError,
  useSessionSettingsChangeable,
  useSessionThinkingLevel,
} from '../useSessionThinkingLevel'

const api = vi.hoisted(() => ({
  getDefaultThinkingLevel: vi.fn(),
  setDefaultThinkingLevel: vi.fn(),
  setSessionThinkingLevel: vi.fn(),
}))

vi.mock('@/shared/lib/ipc', () => ({ api }))

const SESSION = SessionId('session-a')

function seedSession(executionThinkingLevel: 'low' | 'high') {
  const refreshSession = vi.fn().mockResolvedValue(undefined)
  useChatStore.setState({
    activeSessionId: SESSION,
    activeSession: fromPartial({ id: SESSION, executionThinkingLevel }),
    sessionById: new Map([[SESSION, fromPartial({ id: SESSION, executionThinkingLevel })]]),
    refreshSession,
  })
  return refreshSession
}

describe('useSessionThinkingLevel', () => {
  beforeEach(() => {
    resetThinkingLevelWritesForTests()
    resetForegroundSendsForTests()
    useChatStore.setState(useChatStore.getInitialState())
    useBackgroundRunStore.setState({
      activeRunIds: new Set(),
      worktreeLaunchBySessionId: new Map(),
    })
    useFirstSendPendingStore.setState({ ids: new Set() })
    api.getDefaultThinkingLevel.mockReset().mockResolvedValue('xhigh')
    api.setDefaultThinkingLevel.mockReset().mockResolvedValue(undefined)
    api.setSessionThinkingLevel.mockReset().mockResolvedValue({ changed: true })
  })

  it("shows Pi's default for a draft and sets the global default from it", async () => {
    const { result } = renderHookWithQueryClient(() => useSessionThinkingLevel(null))

    await waitFor(() => expect(result.current.level).toBe('xhigh'))
    expect(result.current.canChange).toBe(true)
    await act(() => result.current.setLevel('low'))

    expect(api.setDefaultThinkingLevel).toHaveBeenCalledWith('low')
    expect(api.setSessionThinkingLevel).not.toHaveBeenCalled()
  })

  it("reads the Session's own level and sets it through the Host", async () => {
    const refreshSession = seedSession('high')
    const { result } = renderHookWithQueryClient(() => useSessionThinkingLevel(SESSION))

    expect(result.current.level).toBe('high')
    await act(() => result.current.setLevel('low'))

    expect(api.setSessionThinkingLevel).toHaveBeenCalledWith(SESSION, 'low')
    expect(api.setDefaultThinkingLevel).not.toHaveBeenCalled()
    expect(refreshSession).toHaveBeenCalledWith(SESSION)
  })

  it('cannot change while the Session has an active Run, and surfaces a Host refusal', async () => {
    seedSession('high')
    useBackgroundRunStore.setState({ activeRunIds: new Set([SESSION]) })
    api.setSessionThinkingLevel.mockResolvedValue({ changed: false, code: 'session_run_active' })
    const { result } = renderHookWithQueryClient(() => useSessionThinkingLevel(SESSION))

    expect(result.current.canChange).toBe(false)
    let failure: unknown
    await act(async () => {
      failure = await result.current.setLevel('low').catch((error: unknown) => error)
    })

    expect(failure).toBeInstanceOf(SessionThinkingLevelRefusedError)
    expect(failure).toMatchObject({ code: 'session_run_active' })
    // The refused pick does not stay on screen.
    expect(result.current.level).toBe('high')
  })

  it('cannot change while a Run is starting: first send, a composer send, or a worktree launch', () => {
    seedSession('high')
    const { result } = renderHookWithQueryClient(() => ({
      thinking: useSessionThinkingLevel(SESSION),
      changeable: useSessionSettingsChangeable(SESSION),
    }))
    expect(result.current.changeable).toBe(true)

    act(() => useFirstSendPendingStore.getState().mark(SESSION))
    expect(result.current.thinking.canChange).toBe(false)
    act(() => useFirstSendPendingStore.getState().clear(SESSION))

    act(() => useForegroundSendStore.getState().begin(SESSION))
    expect(result.current.changeable).toBe(false)
    act(() => useForegroundSendStore.getState().end(SESSION))

    act(() =>
      useBackgroundRunStore
        .getState()
        .setWorktreeLaunch(
          SESSION,
          fromPartial({ status: 'running', stage: 'preparing-workspace' }),
        ),
    )
    expect(result.current.changeable).toBe(false)
    act(() =>
      useBackgroundRunStore
        .getState()
        .setWorktreeLaunch(
          SESSION,
          fromPartial({ status: 'failed', stage: 'preparing-workspace' }),
        ),
    )
    expect(result.current.changeable).toBe(true)
    expect(result.current.thinking.canChange).toBe(true)
  })

  it('exposes pending writes so sends wait for the pick to land', async () => {
    seedSession('high')
    let finishWrite: (() => void) | undefined
    api.setSessionThinkingLevel.mockReturnValue(
      new Promise((resolve) => {
        finishWrite = () => resolve({ changed: true })
      }),
    )
    const { result } = renderHookWithQueryClient(() => useSessionThinkingLevel(SESSION))

    let pickSettled = false
    act(() => {
      void result.current.setLevel('low')
    })
    const settled = settledThinkingLevelWrites(SESSION).then(() => {
      pickSettled = true
    })
    await Promise.resolve()
    expect(pickSettled).toBe(false)
    expect(result.current.level).toBe('low')

    await act(async () => {
      finishWrite?.()
      await settled
    })
    expect(pickSettled).toBe(true)
  })

  it("refreshes every cached read of Pi's default when it changes", async () => {
    const client = createRendererQueryClient()
    client.setQueryData(defaultThinkingLevelQueryOptions().queryKey, 'low')
    const { result } = renderHookWithQueryClient(() => useSessionThinkingLevel(null), { client })
    expect(result.current.level).toBe('low')

    await act(() => invalidateDefaultThinkingLevel(client))

    await waitFor(() => expect(result.current.level).toBe('xhigh'))
    expect(api.getDefaultThinkingLevel).toHaveBeenCalledWith()
  })
})
