import { SESSION_TITLE_MAX_LENGTH } from '@shared/session-title'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useSessionStatusStore } from '@/features/sessions/state'
import { useUIStore } from '@/shell/ui-store'
import {
  ORIGINAL_TITLE,
  ORIGINAL_UPDATED_AT,
  renderStoreBackedRow,
  seedTitleStores,
  storedTitles,
  TITLE_SESSION_ID,
} from './SessionListItem.title.test-utils'

const { updateSessionTitleMock } = vi.hoisted(() => ({
  updateSessionTitleMock: vi.fn(),
}))

vi.mock('@/shared/lib/ipc', () => ({
  api: {
    showConfirm: vi.fn(),
    updateSessionTitle: updateSessionTitleMock,
    regenerateSessionTitle: vi.fn(),
  },
}))

function titleField() {
  return screen.getByRole('textbox', { name: 'Session title' })
}

function openRenameFromMenu() {
  fireEvent.contextMenu(screen.getByRole('button', { name: ORIGINAL_TITLE }))
  fireEvent.click(screen.getByText('Rename session'))
}

describe('SessionListItem rename', () => {
  beforeEach(() => {
    updateSessionTitleMock.mockReset()
    updateSessionTitleMock.mockResolvedValue(undefined)
    useUIStore.setState({ toastMessage: null, toastData: null })
    useSessionStatusStore.setState({
      statuses: new Map(),
      completedAt: new Map(),
      lastVisitedAt: new Map(),
    })
    seedTitleStores()
  })

  it('renames from the context menu on Enter, optimistically and without moving the row', async () => {
    renderStoreBackedRow()
    openRenameFromMenu()

    const field = titleField()
    expect(field).toHaveValue(ORIGINAL_TITLE)
    expect(field).toHaveFocus()
    expect(field).toHaveAttribute('maxLength', String(SESSION_TITLE_MAX_LENGTH))

    fireEvent.change(field, { target: { value: '  Login test flake  ' } })
    fireEvent.keyDown(field, { key: 'Enter' })

    expect(screen.queryByRole('textbox', { name: 'Session title' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Login test flake' })).toBeInTheDocument()
    expect(storedTitles()).toEqual({
      sidebar: 'Login test flake',
      chat: 'Login test flake',
      updatedAt: ORIGINAL_UPDATED_AT,
    })
    await waitFor(() =>
      expect(updateSessionTitleMock).toHaveBeenCalledWith(TITLE_SESSION_ID, 'Login test flake'),
    )
    expect(updateSessionTitleMock).toHaveBeenCalledOnce()
  })

  it('enters inline edit when the title text is double-clicked, and saves on blur', async () => {
    renderStoreBackedRow()

    fireEvent.doubleClick(screen.getByText(ORIGINAL_TITLE))
    const field = titleField()
    fireEvent.change(field, { target: { value: 'Blurred title' } })
    fireEvent.pointerDown(document.body)
    fireEvent.blur(field)

    await waitFor(() =>
      expect(updateSessionTitleMock).toHaveBeenCalledWith(TITLE_SESSION_ID, 'Blurred title'),
    )
    expect(updateSessionTitleMock).toHaveBeenCalledOnce()
  })

  it('keeps editing when focus leaves the field without any user input', async () => {
    renderStoreBackedRow()

    fireEvent.doubleClick(screen.getByText(ORIGINAL_TITLE))
    const field = titleField()
    fireEvent.blur(field)

    await waitFor(() => expect(field).toHaveFocus())
    expect(titleField()).toBe(field)
    expect(updateSessionTitleMock).not.toHaveBeenCalled()
  })

  it('renames the focused row with F2', () => {
    renderStoreBackedRow()

    fireEvent.keyDown(screen.getByRole('button', { name: ORIGINAL_TITLE }), { key: 'F2' })

    expect(titleField()).toHaveValue(ORIGINAL_TITLE)
  })

  it('cancels on Escape without saving, even when the field blurs afterwards', () => {
    renderStoreBackedRow()
    openRenameFromMenu()

    const field = titleField()
    fireEvent.change(field, { target: { value: 'Discarded title' } })
    fireEvent.keyDown(field, { key: 'Escape' })
    fireEvent.blur(field)

    expect(screen.getByRole('button', { name: ORIGINAL_TITLE })).toBeInTheDocument()
    expect(updateSessionTitleMock).not.toHaveBeenCalled()
  })

  it.each([
    ['blank', '   '],
    ['unchanged', `  ${ORIGINAL_TITLE} `],
  ])('cancels a %s title without IPC', (_case, value) => {
    renderStoreBackedRow()
    openRenameFromMenu()

    fireEvent.change(titleField(), { target: { value } })
    fireEvent.keyDown(titleField(), { key: 'Enter' })

    expect(screen.getByRole('button', { name: ORIGINAL_TITLE })).toBeInTheDocument()
    expect(storedTitles().sidebar).toBe(ORIGINAL_TITLE)
    expect(updateSessionTitleMock).not.toHaveBeenCalled()
  })

  it('reverts the optimistic title and shows an error toast when the Host rejects', async () => {
    updateSessionTitleMock.mockRejectedValueOnce(new Error('database is locked'))
    renderStoreBackedRow()
    openRenameFromMenu()

    fireEvent.change(titleField(), { target: { value: 'Rejected title' } })
    fireEvent.keyDown(titleField(), { key: 'Enter' })

    await waitFor(() =>
      expect(screen.getByRole('button', { name: ORIGINAL_TITLE })).toBeInTheDocument(),
    )
    expect(storedTitles()).toEqual({
      sidebar: ORIGINAL_TITLE,
      chat: ORIGINAL_TITLE,
      updatedAt: ORIGINAL_UPDATED_AT,
    })
    expect(useUIStore.getState().toastData).toMatchObject({
      message: expect.stringContaining('Failed to rename session'),
      variant: 'error',
    })
  })
})
