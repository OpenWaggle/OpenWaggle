import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useSessionStatusStore, useSessionStore } from '@/features/sessions/state'
import { useUIStore } from '@/shell/ui-store'
import {
  ORIGINAL_TITLE,
  renderStoreBackedRow,
  seedTitleStores,
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

const GENERATED_TITLE = 'Generated session titles'

function titleField() {
  return screen.getByRole('textbox', { name: 'Session title' })
}

function startRename() {
  fireEvent.contextMenu(screen.getByRole('button', { name: ORIGINAL_TITLE }))
  fireEvent.click(screen.getByText('Rename session'))
}

describe('SessionListItem rename edge cases', () => {
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

  it('keeps a generated title that lands while the field is open and untouched', () => {
    renderStoreBackedRow()
    startRename()
    act(() => useSessionStore.getState().applySessionTitle(TITLE_SESSION_ID, GENERATED_TITLE))

    fireEvent.pointerDown(document.body)
    fireEvent.blur(titleField())

    expect(updateSessionTitleMock).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: GENERATED_TITLE })).toBeInTheDocument()
  })

  it('does not save or cancel while an IME composition is confirmed', () => {
    renderStoreBackedRow()
    startRename()
    const field = titleField()
    fireEvent.change(field, { target: { value: 'にほんご' } })

    fireEvent.keyDown(field, { key: 'Enter', isComposing: true })
    fireEvent.keyDown(field, { key: 'Escape', isComposing: true })

    expect(titleField()).toHaveValue('にほんご')
    expect(updateSessionTitleMock).not.toHaveBeenCalled()
  })

  it('returns keyboard focus to the row after Enter and after Escape', async () => {
    renderStoreBackedRow()
    startRename()
    fireEvent.change(titleField(), { target: { value: 'Keyboard rename' } })
    fireEvent.keyDown(titleField(), { key: 'Enter' })
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Keyboard rename' })).toHaveFocus(),
    )

    fireEvent.keyDown(screen.getByRole('button', { name: 'Keyboard rename' }), { key: 'F2' })
    fireEvent.keyDown(titleField(), { key: 'Escape' })
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Keyboard rename' })).toHaveFocus(),
    )
  })
})
