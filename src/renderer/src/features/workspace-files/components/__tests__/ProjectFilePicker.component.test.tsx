import { DEFAULT_SETTINGS } from '@shared/types/settings'
import type { WorkspaceFileEntry } from '@shared/types/workspace-files'
import { act, fireEvent, screen } from '@testing-library/react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { usePreferencesStore } from '@/features/settings/state'
import { renderWithQueryClient } from '@/test-utils/query-test-utils'

const mocks = vi.hoisted(() => ({
  openWorkspaceFile: vi.fn(),
  searchWorkspaceFiles: vi.fn(),
}))

vi.mock('@/shared/lib/ipc', () => ({
  api: { searchWorkspaceFiles: mocks.searchWorkspaceFiles },
}))

vi.mock('@/features/workspace-files/hooks', () => ({
  useOpenWorkspaceFile: () => mocks.openWorkspaceFile,
}))

import { ProjectFilePicker } from '../ProjectFilePicker'

describe('ProjectFilePicker keyboard behavior', () => {
  beforeAll(() => {
    HTMLDialogElement.prototype.showModal ??= function showModal() {
      this.setAttribute('open', '')
    }
    HTMLDialogElement.prototype.close ??= function close() {
      this.removeAttribute('open')
    }
  })

  beforeEach(() => {
    vi.clearAllMocks()
    usePreferencesStore.setState((state) => ({
      ...state,
      settings: { ...DEFAULT_SETTINGS, projectPath: '/project' },
    }))
  })

  it('does not select or open a file while the project index is loading', async () => {
    let resolveSearch: ((entries: WorkspaceFileEntry[]) => void) | undefined
    mocks.searchWorkspaceFiles.mockReturnValue(
      new Promise<WorkspaceFileEntry[]>((resolve) => {
        resolveSearch = resolve
      }),
    )
    renderWithQueryClient(<ProjectFilePicker />)
    const input = screen.getByRole('textbox', { name: 'Search project files' })

    expect(screen.getByText('Indexing project files…')).toBeInTheDocument()
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(mocks.openWorkspaceFile).not.toHaveBeenCalled()
    await act(async () => resolveSearch?.([]))
  })

  it('does not select or open a file when the search has no matches', async () => {
    mocks.searchWorkspaceFiles.mockResolvedValue([])
    renderWithQueryClient(<ProjectFilePicker />)
    const input = screen.getByRole('textbox', { name: 'Search project files' })
    await vi.waitFor(() => expect(screen.getByText('No matching files.')).toBeInTheDocument())

    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(mocks.openWorkspaceFile).not.toHaveBeenCalled()
  })
})
