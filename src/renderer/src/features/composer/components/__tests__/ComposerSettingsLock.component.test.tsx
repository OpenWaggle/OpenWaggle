import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  useBackgroundRunStore,
  useChatStore,
  useQueuedRunStartStore,
  useRunFinishingStore,
} from '@/features/chat/state'
import { useComposerStore } from '@/features/composer/state/composer-store'
import { useUIStore } from '@/shell/ui-store'
import {
  SESSION_SETTINGS_LOCKED_BY_QUEUE_REASON,
  SESSION_SETTINGS_LOCKED_REASON,
  SESSION_SETTINGS_MATERIALIZING_REASON,
} from '../../lib/session-settings-lock'
import {
  expectLocked,
  expectUnlocked,
  MODEL,
  openSession,
  queuedItem,
  renderPickers,
  resetPickers,
  SESSION,
  seedQueue,
} from './composer-settings-lock.test-support'

const api = vi.hoisted(() => ({
  getSettings: vi.fn().mockResolvedValue({}),
  updateSettings: vi.fn().mockResolvedValue({ ok: true }),
  getProviderModels: vi.fn().mockResolvedValue([]),
  setSessionModel: vi.fn().mockResolvedValue(undefined),
  getSessionDetail: vi.fn().mockResolvedValue(null),
  getDefaultThinkingLevel: vi.fn().mockResolvedValue('medium'),
  setDefaultThinkingLevel: vi.fn().mockResolvedValue(undefined),
  setSessionThinkingLevel: vi.fn().mockResolvedValue({ changed: true }),
  querySessionControl: vi.fn().mockRejectedValue(new Error('No Session Host in this test')),
}))

vi.mock('@/shared/lib/ipc', () => ({ api }))

describe('composer Session settings pickers', () => {
  beforeEach(() => {
    resetPickers()
    api.setSessionThinkingLevel.mockReset().mockResolvedValue({ changed: true })
  })

  it('stay enabled for a new Session draft', () => {
    useChatStore.setState({ activeSessionId: null })
    renderPickers()

    expectUnlocked()
  })

  it('stay enabled while the Session is idle', () => {
    openSession()
    renderPickers()

    expectUnlocked()
  })

  it('stay enabled while the Session waits on a paused queue', () => {
    openSession()
    seedQueue({ state: 'paused', items: [queuedItem()] })
    renderPickers()

    expectUnlocked()
  })

  it('stay enabled while the Session waits on a next message held for an edit', () => {
    openSession()
    seedQueue({
      waitingOnEdit: true,
      items: [
        queuedItem({ editHold: { heldByCurrentUser: true, acquiredAt: 1, leaseExpiresAt: 2 } }),
      ],
    })
    renderPickers()

    expectUnlocked()
  })

  it('are disabled with a reason while a Run is active', () => {
    openSession()
    useBackgroundRunStore.getState().addActiveRun(SESSION, MODEL)
    renderPickers()

    expectLocked(SESSION_SETTINGS_LOCKED_REASON)
  })

  it('suggest pausing the queue during a chain of queued Runs', () => {
    openSession()
    useBackgroundRunStore.getState().addActiveRun(SESSION, MODEL)
    seedQueue({ items: [queuedItem()] })
    renderPickers()

    expectLocked(SESSION_SETTINGS_LOCKED_BY_QUEUE_REASON)
  })

  it('stay disabled while a Run is active even with the queue paused, as the Host would refuse', () => {
    openSession()
    useBackgroundRunStore.getState().addActiveRun(SESSION, MODEL)
    seedQueue({ state: 'paused', items: [queuedItem()] })
    renderPickers()

    expectLocked(SESSION_SETTINGS_LOCKED_REASON)
  })

  it('stay disabled in the finishing gap, which is still a Run to the Host', () => {
    openSession()
    seedQueue({ items: [queuedItem()] })
    useRunFinishingStore.getState().mark(SESSION)
    renderPickers()

    expectLocked(SESSION_SETTINGS_LOCKED_BY_QUEUE_REASON)
  })

  it('are disabled while a Run is still starting, such as a worktree launch', () => {
    openSession()
    useBackgroundRunStore.getState().setWorktreeLaunch(SESSION, {
      status: 'running',
      stage: 'preparing-workspace',
      startedAt: 1,
      updatedAt: 1,
      details: [],
    })
    renderPickers()

    expectLocked(SESSION_SETTINGS_LOCKED_REASON)
  })

  it('close an open thinking menu when a Run starts, so it stays closed when the Run ends', () => {
    openSession()
    renderPickers()

    fireEvent.click(screen.getByRole('button', { name: /^Thinking level:/ }))
    expect(screen.getByRole('menuitemradio', { name: 'High' })).toBeInTheDocument()
    act(() => useBackgroundRunStore.getState().addActiveRun(SESSION, MODEL))
    expect(screen.queryByRole('menuitemradio', { name: 'High' })).not.toBeInTheDocument()
    expect(useComposerStore.getState().thinkingMenuOpen).toBe(false)
    act(() => useBackgroundRunStore.getState().removeActiveRun(SESSION))

    expectUnlocked()
    expect(screen.queryByRole('menuitemradio', { name: 'High' })).not.toBeInTheDocument()
  })

  it('lock both pickers while a draft creates its Session, and say why', () => {
    useChatStore.setState({
      activeSessionId: null,
      draftSession: { projectPath: '/project', isMaterializing: true },
    })
    renderPickers()

    expectLocked(SESSION_SETTINGS_MATERIALIZING_REASON)
    fireEvent.click(screen.getByRole('button', { name: /^Thinking level:/ }))
    expect(screen.queryByRole('menuitemradio', { name: 'High' })).not.toBeInTheDocument()
  })

  it('stay disabled while the Host reports a Run this window did not start, such as from the CLI', () => {
    openSession()
    seedQueue({ activeRunId: 'run-from-cli' })
    renderPickers()

    expectLocked(SESSION_SETTINGS_LOCKED_REASON)
  })

  it('stay disabled from a queue action that started a Run until the Run reports in', () => {
    openSession()
    useQueuedRunStartStore.getState().mark(SESSION, 'run-resumed')
    renderPickers()

    expectLocked(SESSION_SETTINGS_LOCKED_REASON)
    act(() => useQueuedRunStartStore.getState().settle(SESSION, 'run-resumed'))
    expectUnlocked()
  })

  it('return focus to the thinking trigger when the lock closes its menu', async () => {
    openSession()
    renderPickers()

    // A keyboard user opens the menu from the focused trigger.
    const opener = screen.getByRole('button', { name: /^Thinking level:/ })
    act(() => opener.focus())
    fireEvent.click(opener)
    await waitFor(() => expect(screen.getByRole('menuitemradio', { name: 'Medium' })).toHaveFocus())
    act(() => useBackgroundRunStore.getState().addActiveRun(SESSION, MODEL))

    const trigger = screen.getByRole('button', { name: /^Thinking level:/ })
    await waitFor(() => expect(trigger).toHaveFocus())
    expect(trigger).toHaveAccessibleDescription(SESSION_SETTINGS_LOCKED_REASON)
  })

  it('return focus to the model trigger when the lock closes its list', () => {
    openSession()
    renderPickers()

    fireEvent.click(screen.getByRole('button', { name: 'GPT 5' }))
    const option = screen.getByRole('option', { name: /GPT 5/ })
    act(() => option.focus())
    act(() => useBackgroundRunStore.getState().addActiveRun(SESSION, MODEL))

    expect(screen.queryByRole('option', { name: /GPT 5/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'GPT 5' })).toHaveFocus()
  })

  it('leave focus alone when the lock engages with the model list closed', () => {
    openSession()
    renderPickers()
    const elsewhere = screen.getByRole('button', { name: /^Thinking level:/ })
    act(() => elsewhere.focus())

    act(() => useBackgroundRunStore.getState().addActiveRun(SESSION, MODEL))

    expect(elsewhere).toHaveFocus()
  })

  it('keep the level and show a toast when the Host refuses a thinking-level pick', async () => {
    openSession()
    api.setSessionThinkingLevel.mockResolvedValue({ changed: false, code: 'session_run_active' })
    renderPickers()

    fireEvent.click(screen.getByRole('button', { name: /^Thinking level:/ }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'High' }))

    await waitFor(() =>
      expect(useUIStore.getState().toastData).toMatchObject({
        message: expect.stringContaining('only while no Run is active'),
        variant: 'error',
      }),
    )
    expect(api.setSessionThinkingLevel).toHaveBeenCalledWith(SESSION, 'high')
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Thinking level: Medium' })).toBeInTheDocument(),
    )
  })
})
