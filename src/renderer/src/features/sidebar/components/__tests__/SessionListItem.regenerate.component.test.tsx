import {
  SESSION_TITLE_MODEL_AUTOMATIC,
  SESSION_TITLE_MODEL_OFF,
  type SessionTitleModelSetting,
} from '@shared/session-title-model'
import type { SessionTitleRegenerationResult } from '@shared/types/session-title'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionTitleMessages } from '@/features/session-title'
import { useSessionStatusStore } from '@/features/sessions/state'
import { usePreferencesStore } from '@/features/settings/state'
import { useUIStore } from '@/shell/ui-store'
import {
  ORIGINAL_TITLE,
  ORIGINAL_UPDATED_AT,
  renderStoreBackedRow,
  seedTitleStores,
  storedTitles,
  TITLE_SESSION_ID,
} from './SessionListItem.title.test-utils'

const { regenerateSessionTitleMock } = vi.hoisted(() => ({
  regenerateSessionTitleMock: vi.fn(),
}))

vi.mock('@/shared/lib/ipc', () => ({
  api: {
    showConfirm: vi.fn(),
    updateSessionTitle: vi.fn(),
    regenerateSessionTitle: regenerateSessionTitleMock,
  },
}))

function setTitleModel(sessionTitleModel: SessionTitleModelSetting) {
  usePreferencesStore.setState((state) => ({
    settings: { ...state.settings, sessionTitleModel },
  }))
}

function openMenu(title: string = ORIGINAL_TITLE) {
  fireEvent.contextMenu(screen.getByRole('button', { name: title }))
}

function regenerate() {
  openMenu()
  fireEvent.click(screen.getByText('Regenerate title'))
}

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined
  const promise = new Promise<T>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

describe('SessionListItem title regeneration', () => {
  beforeEach(() => {
    regenerateSessionTitleMock.mockReset()
    useUIStore.setState({ toastMessage: null, toastData: null })
    useSessionStatusStore.setState({
      statuses: new Map(),
      completedAt: new Map(),
      lastVisitedAt: new Map(),
    })
    setTitleModel(SESSION_TITLE_MODEL_AUTOMATIC)
    seedTitleStores()
  })

  it('hides Regenerate title when the Title model is Off', () => {
    setTitleModel(SESSION_TITLE_MODEL_OFF)
    renderStoreBackedRow()
    openMenu()

    expect(screen.getByText('Rename session')).toBeInTheDocument()
    expect(screen.queryByText('Regenerate title')).not.toBeInTheDocument()
  })

  it('applies a renamed title without moving the row and without a message', async () => {
    regenerateSessionTitleMock.mockResolvedValueOnce({
      outcome: 'renamed',
      title: 'Login test flake',
    } satisfies SessionTitleRegenerationResult)
    renderStoreBackedRow()
    regenerate()

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Login test flake' })).toBeInTheDocument(),
    )
    expect(regenerateSessionTitleMock).toHaveBeenCalledWith(TITLE_SESSION_ID)
    expect(storedTitles()).toEqual({
      sidebar: 'Login test flake',
      chat: 'Login test flake',
      updatedAt: ORIGINAL_UPDATED_AT,
    })
    expect(useUIStore.getState().toastData).toBeNull()
  })

  it('shows that a regeneration is running until it ends', async () => {
    const pending = Promise.withResolvers<SessionTitleRegenerationResult>()
    regenerateSessionTitleMock.mockReturnValueOnce(pending.promise)
    renderStoreBackedRow()
    regenerate()

    expect(useUIStore.getState().toastData?.message).toBe(SessionTitleMessages.regenerating)
    pending.resolve({ outcome: 'superseded' })
    await waitFor(() => expect(useUIStore.getState().toastData).toBeNull())
  })

  it('says the title already fits when the model keeps it', async () => {
    regenerateSessionTitleMock.mockResolvedValueOnce({
      outcome: 'unchanged',
      title: ORIGINAL_TITLE,
    } satisfies SessionTitleRegenerationResult)
    renderStoreBackedRow()
    regenerate()

    await waitFor(() =>
      expect(useUIStore.getState().toastData?.message).toBe(SessionTitleMessages.unchanged),
    )
    expect(storedTitles().sidebar).toBe(ORIGINAL_TITLE)
  })

  it('stays quiet when a newer title superseded the regeneration', async () => {
    regenerateSessionTitleMock.mockResolvedValueOnce({
      outcome: 'superseded',
    } satisfies SessionTitleRegenerationResult)
    renderStoreBackedRow()
    regenerate()

    await waitFor(() => expect(regenerateSessionTitleMock).toHaveBeenCalledOnce())
    await Promise.resolve()
    expect(useUIStore.getState().toastData).toBeNull()
    expect(storedTitles().sidebar).toBe(ORIGINAL_TITLE)
  })

  it.each(['off', 'empty', 'no-model', 'busy'] as const)(
    'explains an unavailable regeneration (%s)',
    async (reason) => {
      regenerateSessionTitleMock.mockResolvedValueOnce({
        outcome: 'unavailable',
        reason,
      } satisfies SessionTitleRegenerationResult)
      renderStoreBackedRow()
      regenerate()

      await waitFor(() =>
        expect(useUIStore.getState().toastData?.message).toBe(
          SessionTitleMessages.unavailable[reason],
        ),
      )
    },
  )

  it('shows the safe failure message as an error toast', async () => {
    regenerateSessionTitleMock.mockResolvedValueOnce({
      outcome: 'failed',
      message: 'The provider rejected the request.',
    } satisfies SessionTitleRegenerationResult)
    renderStoreBackedRow()
    regenerate()

    await waitFor(() =>
      expect(useUIStore.getState().toastData).toMatchObject({
        message: "Couldn't regenerate the title: The provider rejected the request.",
        variant: 'error',
      }),
    )
    expect(storedTitles().sidebar).toBe(ORIGINAL_TITLE)
  })

  it('does not start a second regeneration while one is running', async () => {
    const pending = deferred<SessionTitleRegenerationResult>()
    regenerateSessionTitleMock.mockReturnValueOnce(pending.promise)
    renderStoreBackedRow()
    regenerate()

    openMenu()
    const running = screen.getByRole('button', { name: /Regenerating title/ })
    expect(running).toBeDisabled()
    fireEvent.click(running)
    expect(regenerateSessionTitleMock).toHaveBeenCalledOnce()

    pending.resolve({ outcome: 'renamed', title: 'Login test flake' })
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Login test flake' })).toBeInTheDocument(),
    )
    openMenu('Login test flake')
    expect(screen.getByRole('button', { name: 'Regenerate title' })).toBeEnabled()
  })
})
