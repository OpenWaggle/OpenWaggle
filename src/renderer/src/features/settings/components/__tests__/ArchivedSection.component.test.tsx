import { SessionId } from '@shared/types/brand'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useUIStore } from '@/shell/ui-store'
import { renderWithQueryClient } from '@/test-utils/query-test-utils'
import {
  archivedPage,
  branchItem,
  sessionItem,
  transcriptItem,
} from './archived-section.test-utils'

const api = vi.hoisted(() => ({
  queryArchivedItems: vi.fn(),
  listArchivedItemRefs: vi.fn(),
  setArchivedItems: vi.fn(),
  deleteSession: vi.fn(),
  showConfirm: vi.fn(),
  closeBrowserPreview: vi.fn(async () => undefined),
  unregisterBrowserPreviewOwner: vi.fn(async () => undefined),
}))
const navigate = vi.hoisted(() => vi.fn(async () => undefined))
const loadSessions = vi.hoisted(() => vi.fn(async () => undefined))

vi.mock('@/shared/lib/ipc', () => ({ api }))
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useNavigate: () => navigate,
}))
vi.mock('@/features/sessions/state', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useSessionStore: (selector: (state: { loadSessions: typeof loadSessions }) => unknown) =>
    selector({ loadSessions }),
}))

import { ArchivedSection } from '../sections/ArchivedSection'

function rowFor(title: string) {
  const row = [...document.querySelectorAll('[data-qa="archived-item-row"]')].find((candidate) =>
    candidate.textContent?.includes(title),
  )
  if (!(row instanceof HTMLElement)) throw new Error(`No row for ${title}`)
  return row
}

describe('ArchivedSection', () => {
  beforeEach(() => {
    for (const mock of Object.values(api)) mock.mockReset()
    api.queryArchivedItems.mockResolvedValue(
      archivedPage([sessionItem, transcriptItem, branchItem]),
    )
    api.setArchivedItems.mockImplementation(async ({ items }) => ({ changed: items, failed: [] }))
    api.showConfirm.mockResolvedValue(true)
    api.deleteSession.mockResolvedValue(undefined)
    navigate.mockClear()
    loadSessions.mockClear()
    useUIStore.getState().clearToast()
  })

  it('lists archived sessions and branches by archive date with facet counts', async () => {
    renderWithQueryClient(<ArchivedSection />)

    expect(await screen.findByText('Migrate settings to Effect Schema')).toBeInTheDocument()
    expect(api.queryArchivedItems).toHaveBeenCalledWith({ sort: 'recent', limit: 50 })
    expect(screen.getByRole('heading', { name: 'Today' })).toBeInTheDocument()
    expect(screen.getByText(/Branch of Archive search prototypes/u)).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'openwaggle (2)' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Branches 1' })).toBeInTheDocument()
    expect(screen.getByText('3 results')).toBeInTheDocument()
  })

  it('searches as the user types and shows the transcript excerpt', async () => {
    renderWithQueryClient(<ArchivedSection />)
    await screen.findByText('Migrate settings to Effect Schema')
    api.queryArchivedItems.mockResolvedValue(archivedPage([transcriptItem]))

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search archived items' }), {
      target: { value: 'token' },
    })

    await waitFor(() =>
      expect(api.queryArchivedItems).toHaveBeenLastCalledWith({
        text: 'token',
        sort: 'match',
        limit: 50,
      }),
    )
    await waitFor(() => expect(screen.queryByText('Migrate settings to Effect Schema')).toBeNull())
    expect(screen.getByRole('heading', { name: 'Best matches' })).toBeInTheDocument()
    expect(screen.getByText('refresh', { selector: 'mark' })).toBeInTheDocument()
  })

  it('narrows by project and type, and clears the filters', async () => {
    renderWithQueryClient(<ArchivedSection />)
    await screen.findByText('Migrate settings to Effect Schema')

    fireEvent.change(screen.getByRole('combobox', { name: 'Project' }), {
      target: { value: '/work/ts-match' },
    })
    fireEvent.click(screen.getByRole('radio', { name: 'Branches 1' }))

    await waitFor(() =>
      expect(api.queryArchivedItems).toHaveBeenLastCalledWith({
        project: { projectPath: '/work/ts-match' },
        kind: 'branch',
        sort: 'recent',
        limit: 50,
      }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(screen.getByRole('combobox', { name: 'Project' })).toHaveValue('__all__')
    expect(screen.getByRole('radio', { name: /^All/u })).toHaveAttribute('aria-checked', 'true')
    expect(screen.queryByRole('button', { name: 'Clear filters' })).toBeNull()
  })

  it('restores one item and offers Undo, which archives it again', async () => {
    renderWithQueryClient(<ArchivedSection />)
    await screen.findByText('Migrate settings to Effect Schema')

    fireEvent.click(
      within(rowFor('Migrate settings')).getByRole('button', {
        name: 'Restore Migrate settings to Effect Schema',
      }),
    )

    await waitFor(() =>
      expect(useUIStore.getState().toastData?.message).toBe(
        'Restored “Migrate settings to Effect Schema”',
      ),
    )
    expect(api.setArchivedItems).toHaveBeenCalledWith({ archived: false, items: [sessionItem.ref] })
    expect(loadSessions).toHaveBeenCalled()

    useUIStore.getState().toastData?.action?.onClick?.()
    await waitFor(() =>
      expect(api.setArchivedItems).toHaveBeenLastCalledWith({
        archived: true,
        items: [sessionItem.ref],
      }),
    )
  })

  it('restores a shift-click range in one call', async () => {
    renderWithQueryClient(<ArchivedSection />)
    await screen.findByText('Migrate settings to Effect Schema')

    fireEvent.click(
      screen.getByRole('checkbox', { name: 'Select Migrate settings to Effect Schema' }),
    )
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Alternative approach' }), {
      shiftKey: true,
    })
    expect(screen.getByText('3 selected')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /^Restore 3$/u }))
    await waitFor(() =>
      expect(api.setArchivedItems).toHaveBeenCalledWith({
        archived: false,
        items: [sessionItem.ref, transcriptItem.ref, branchItem.ref],
      }),
    )
    await waitFor(() => expect(screen.queryByText('3 selected')).toBeNull())
    expect(useUIStore.getState().toastData?.message).toBe('Restored 3 items')
  })

  it('selects every match through the Host, including rows not loaded yet', async () => {
    api.listArchivedItemRefs.mockResolvedValue({
      refs: [sessionItem.ref, transcriptItem.ref, branchItem.ref],
      total: 3,
    })
    renderWithQueryClient(<ArchivedSection />)
    await screen.findByText('Migrate settings to Effect Schema')

    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all 3' }))

    expect(await screen.findByText('3 selected')).toBeInTheDocument()
    expect(api.listArchivedItemRefs).toHaveBeenCalledWith({ limit: 1_000 })
  })

  it('deletes only after confirmation, and never offers delete for a branch', async () => {
    renderWithQueryClient(<ArchivedSection />)
    await screen.findByText('Migrate settings to Effect Schema')
    expect(
      within(rowFor('Alternative approach')).queryByRole('button', { name: /Delete/u }),
    ).toBeNull()

    api.showConfirm.mockResolvedValueOnce(false)
    fireEvent.click(
      screen.getByRole('button', { name: 'Delete Migrate settings to Effect Schema permanently' }),
    )
    await waitFor(() => expect(api.showConfirm).toHaveBeenCalledTimes(1))
    expect(api.deleteSession).not.toHaveBeenCalled()

    fireEvent.click(
      screen.getByRole('button', { name: 'Delete Migrate settings to Effect Schema permanently' }),
    )
    await waitFor(() =>
      expect(api.deleteSession).toHaveBeenCalledWith(SessionId('session-settings')),
    )
    expect(api.showConfirm).toHaveBeenLastCalledWith(
      'Delete permanently?',
      'This permanently deletes this session. This cannot be undone.',
    )
  })

  it('opens an archived session without restoring it', async () => {
    renderWithQueryClient(<ArchivedSection />)
    await screen.findByText('Migrate settings to Effect Schema')

    fireEvent.click(screen.getByRole('button', { name: 'Open Migrate settings to Effect Schema' }))

    expect(navigate).toHaveBeenCalledWith({
      to: '/sessions/$sessionId',
      params: { sessionId: 'session-settings' },
    })
    expect(api.setArchivedItems).not.toHaveBeenCalled()
  })

  it('shows the empty state when nothing is archived', async () => {
    api.queryArchivedItems.mockResolvedValue(archivedPage([]))
    renderWithQueryClient(<ArchivedSection />)

    expect(await screen.findByText('No archived sessions or branches')).toBeInTheDocument()
    expect(screen.queryByRole('searchbox')).toBeNull()
  })

  it('names the items a restore could not bring back', async () => {
    api.setArchivedItems.mockResolvedValue({
      changed: [],
      failed: [{ ref: sessionItem.ref, message: 'Session is busy' }],
    })
    renderWithQueryClient(<ArchivedSection />)
    await screen.findByText('Migrate settings to Effect Schema')

    fireEvent.click(
      screen.getByRole('button', { name: 'Restore Migrate settings to Effect Schema' }),
    )

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not restore 1 item: Session is busy',
    )
  })
})
