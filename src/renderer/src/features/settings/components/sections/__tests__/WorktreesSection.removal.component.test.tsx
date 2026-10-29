import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithQueryClient } from '@/test-utils/query-test-utils'
import {
  createPreferencesMock,
  createWorktreeApiMocks,
  entry,
  inventory,
  PROJECT,
  preview,
  rowTitled,
} from './worktree-inventory-fixtures'

const mocks = vi.hoisted(() => {
  const api: Record<string, unknown> = {}
  const preferences: Record<string, unknown> = {}
  return { api, preferences }
})
vi.mock('@/features/settings/state/preferences-store', () => ({
  usePreferencesStore: (select: (value: unknown) => unknown) => select(mocks.preferences),
}))
vi.mock('@/shared/lib/ipc', () => ({ api: mocks.api }))

import { WorktreesSection } from '../WorktreesSection'

let api = createWorktreeApiMocks()

const OPEN_SESSION = {
  sessionId: 'open',
  title: 'Fix the login bug',
  archived: false,
  archivedAt: null,
  running: false,
  owner: true,
}

beforeEach(() => {
  api = createWorktreeApiMocks()
  Object.assign(mocks.api, api)
  Object.assign(mocks.preferences, createPreferencesMock())
})

async function confirmIn(dialogName: RegExp | string, button: string) {
  const dialog = await screen.findByRole('dialog', { name: dialogName })
  const confirm = within(dialog).getByRole('button', { name: button })
  await waitFor(() => expect(confirm).toBeEnabled())
  fireEvent.click(confirm)
  return dialog
}

describe('removing a worktree that is safe to remove', () => {
  it('asks once more inline, then removes it without a dialog', async () => {
    api.getWorktreeInventory.mockResolvedValue(inventory([entry({ path: '/wt/free' })]))
    renderWithQueryClient(<WorktreesSection />)

    const row = await rowTitled('free')
    expect(await row.findByText('Frees about 1.0 MB')).toBeInTheDocument()
    fireEvent.click(row.getByRole('button', { name: 'Remove free' }))
    expect(api.removeGitWorktree).not.toHaveBeenCalled()
    fireEvent.click(row.getByRole('button', { name: 'Confirm remove free' }))

    await waitFor(() =>
      expect(api.removeGitWorktree).toHaveBeenCalledWith(PROJECT, { path: '/wt/free' }),
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('keeps keyboard focus on the buttons that replace the one pressed', async () => {
    api.getWorktreeInventory.mockResolvedValue(inventory([entry({ path: '/wt/free' })]))
    renderWithQueryClient(<WorktreesSection />)

    const row = await rowTitled('free')
    fireEvent.click(row.getByRole('button', { name: 'Remove free' }))
    expect(row.getByRole('button', { name: 'Cancel removing free' })).toHaveFocus()
    fireEvent.click(row.getByRole('button', { name: 'Cancel removing free' }))
    expect(row.getByRole('button', { name: 'Remove free' })).toHaveFocus()
    expect(api.removeGitWorktree).not.toHaveBeenCalled()

    // Confirming leaves focus on the row's button while the removal runs.
    api.removeGitWorktree.mockReturnValue(new Promise(() => undefined))
    fireEvent.click(row.getByRole('button', { name: 'Remove free' }))
    fireEvent.click(row.getByRole('button', { name: 'Confirm remove free' }))
    const removing = await row.findByRole('button', { name: 'Removing free' })
    expect(removing).toHaveFocus()
    expect(removing).toHaveAttribute('aria-disabled', 'true')
  })

  it('frees every safe worktree from one confirmation that lists them', async () => {
    api.getWorktreeInventory.mockResolvedValue(
      inventory([
        entry({ path: '/wt/one' }),
        entry({ path: '/wt/two', projectPath: '/other' }),
        entry({ path: '/wt/busy', group: 'in-use' }),
      ]),
    )
    renderWithQueryClient(<WorktreesSection />)

    const free = await screen.findByRole('button', { name: 'Free about 2.0 MB (2)…' })
    fireEvent.click(free)
    const dialog = await confirmIn(
      /Remove 2 worktrees and free about 2\.0 MB/,
      'Remove 2 worktrees',
    )
    expect(within(dialog).getByRole('list', { name: 'Worktrees to remove' })).toHaveTextContent(
      /one.*two/,
    )

    await waitFor(() => expect(api.removeGitWorktree).toHaveBeenCalledTimes(2))
    expect(api.removeGitWorktree).toHaveBeenCalledWith('/other', { path: '/wt/two' })
    const { useUIStore } = await import('@/shell/ui-store')
    await waitFor(() =>
      expect(useUIStore.getState().toastMessage).toBe('Removed 2 worktrees, freeing about 2.0 MB.'),
    )
  })
})

describe('a worktree that needs a decision', () => {
  it('says what would be lost and discards it only once confirmed', async () => {
    api.getWorktreeInventory.mockResolvedValue(
      inventory([
        entry({
          path: '/wt/dirty',
          group: 'decide',
          uncommittedChangeCount: 3,
          attention: [{ kind: 'uncommitted-changes', count: 3 }],
        }),
      ]),
    )
    renderWithQueryClient(<WorktreesSection />)

    const row = await rowTitled('dirty')
    expect(row.getByText('3 uncommitted changes')).toBeInTheDocument()
    fireEvent.click(row.getByRole('button', { name: 'Discard & remove dirty…' }))
    await confirmIn('Discard the changes and remove this worktree?', 'Discard & remove')

    await waitFor(() =>
      expect(api.removeGitWorktree).toHaveBeenCalledWith(PROJECT, {
        path: '/wt/dirty',
        force: true,
      }),
    )
  })

  it('says a locked worktree is unlocked, not that changes are discarded', async () => {
    api.getWorktreeInventory.mockResolvedValue(
      inventory([entry({ path: '/wt/held', group: 'decide', attention: [{ kind: 'locked' }] })]),
    )
    renderWithQueryClient(<WorktreesSection />)

    fireEvent.click(
      (await rowTitled('held')).getByRole('button', { name: 'Unlock & remove held…' }),
    )
    const dialog = await confirmIn('Unlock and remove this worktree?', 'Unlock & remove')

    expect(dialog).not.toHaveTextContent(/discard/i)
    expect(dialog).toHaveTextContent('still refuses if it has uncommitted changes')
    await waitFor(() =>
      expect(api.removeGitWorktree).toHaveBeenCalledWith(PROJECT, {
        path: '/wt/held',
        force: true,
        lockOnly: true,
      }),
    )
  })

  it('offers a locked worktree whose changes Git could not report as a discard', async () => {
    api.getWorktreeInventory.mockResolvedValue(
      inventory([
        entry({
          path: '/wt/unknown',
          group: 'decide',
          uncommittedChangeCount: null,
          attention: [{ kind: 'unknown-state' }, { kind: 'locked' }],
        }),
      ]),
    )
    renderWithQueryClient(<WorktreesSection />)

    fireEvent.click(
      (await rowTitled('unknown')).getByRole('button', { name: 'Discard & remove unknown…' }),
    )
    await confirmIn('Discard the changes and remove this worktree?', 'Discard & remove')
    await waitFor(() =>
      expect(api.removeGitWorktree).toHaveBeenCalledWith(PROJECT, {
        path: '/wt/unknown',
        force: true,
      }),
    )
  })

  it('warns about commits that no remote has, and stays closed to a worktree now in use', async () => {
    api.getWorktreeInventory.mockResolvedValue(
      inventory([
        entry({
          path: '/wt/ahead',
          group: 'decide',
          attention: [{ kind: 'unpublished-commits', count: 2 }],
        }),
      ]),
    )
    api.manageProjectActions.mockImplementation(async (request) =>
      preview(request, {
        branch: 'ow/ahead',
        unpublishedCommitCount: 2,
        usage: {
          path: '/wt/ahead',
          sessions: [],
          blockers: [{ kind: 'terminal', message: 'A terminal is open in it.' }],
        },
      }),
    )
    renderWithQueryClient(<WorktreesSection />)

    fireEvent.click((await rowTitled('ahead')).getByRole('button', { name: 'Remove ahead…' }))
    const dialog = await screen.findByRole('dialog', { name: 'Remove this worktree?' })
    expect(
      await within(dialog).findByText(/ow\/ahead has 2 commits that are not on any remote/),
    ).toBeInTheDocument()
    expect(within(dialog).getByText('A terminal is open in it.')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Remove worktree' })).toBeDisabled()
  })
})

describe('a worktree in use', () => {
  it('starts collapsed, and Archive & remove names each Session it archives', async () => {
    api.getWorktreeInventory.mockResolvedValue(
      inventory([
        entry({
          path: '/wt/open',
          group: 'in-use',
          sessions: [OPEN_SESSION],
          blockers: [{ kind: 'session', message: 'Archive that Session first.' }],
          attention: [{ kind: 'open-sessions', count: 1 }],
        }),
      ]),
    )
    // A local Session opened inside the worktree is archived too, so it is named as well.
    const visitor = { ...OPEN_SESSION, sessionId: 'visitor', title: 'Local look', owner: false }
    api.manageProjectActions.mockImplementation(async (request) =>
      preview(request, {
        usage: {
          path: '/wt/open',
          sessions: [OPEN_SESSION, visitor],
          blockers: [{ kind: 'session', message: 'Archive that Session first.' }],
        },
      }),
    )
    renderWithQueryClient(<WorktreesSection />)

    expect(screen.queryByText('Fix the login bug')).not.toBeInTheDocument()
    fireEvent.click(await screen.findByRole('button', { name: /In use/ }))
    fireEvent.click(
      (await rowTitled('Fix the login bug')).getByRole('button', {
        name: 'Archive & remove Fix the login bug…',
      }),
    )
    const dialog = await screen.findByRole('dialog', {
      name: 'Archive its Sessions and remove this worktree?',
    })
    expect(await within(dialog).findByText(/Archives:\s*Fix the login bug/)).toBeInTheDocument()
    expect(within(dialog).getByText(/Archives:\s*Local look/)).toBeInTheDocument()
    expect(within(dialog).getByText(/If you restore a Session later/)).toBeInTheDocument()
    await confirmIn('Archive its Sessions and remove this worktree?', 'Archive & remove')

    await waitFor(() =>
      expect(api.archiveAndRemoveWorktree).toHaveBeenCalledWith(PROJECT, {
        path: '/wt/open',
        sessionIds: [OPEN_SESSION.sessionId, 'visitor'],
      }),
    )
  })

  it('offers no removal while a terminal is open in it, and says so', async () => {
    api.getWorktreeInventory.mockResolvedValue(
      inventory([
        entry({
          path: '/wt/terminal',
          group: 'in-use',
          blockers: [{ kind: 'terminal', message: 'A terminal is open in it.' }],
        }),
      ]),
    )
    renderWithQueryClient(<WorktreesSection />)

    fireEvent.click(await screen.findByRole('button', { name: /In use/ }))
    const row = await rowTitled('terminal')
    expect(row.getByText('In use: A terminal is open in it.')).toBeInTheDocument()
    expect(row.queryByRole('button', { name: /remove/i })).not.toBeInTheDocument()
  })
})

describe('many worktrees across projects', () => {
  it('narrows to one project and finds a worktree by branch or Session title', async () => {
    api.getWorktreeInventory.mockResolvedValue(
      inventory([
        entry({ path: '/wt/a', branch: 'ow/payments' }),
        entry({ path: '/wt/b', projectPath: '/other' }),
        entry({
          path: '/wt/c',
          archivedAt: 1,
          sessions: [{ ...OPEN_SESSION, archived: true, archivedAt: 1, title: 'Refactor search' }],
        }),
      ]),
    )
    renderWithQueryClient(<WorktreesSection />)

    expect(await screen.findByText('3 worktrees')).toBeInTheDocument()
    fireEvent.change(screen.getByRole('combobox', { name: 'Project' }), {
      target: { value: '/other' },
    })
    expect(screen.getByText('1 worktree')).toBeInTheDocument()
    fireEvent.change(screen.getByRole('combobox', { name: 'Project' }), { target: { value: '' } })

    const search = screen.getByRole('searchbox', { name: 'Search worktrees' })
    fireEvent.change(search, { target: { value: 'payments' } })
    expect(screen.getByText('1 of 3 worktrees')).toBeInTheDocument()
    fireEvent.change(search, { target: { value: 'refactor' } })
    expect(screen.getByText('Refactor search')).toBeInTheDocument()
    fireEvent.change(search, { target: { value: 'nothing like this' } })
    expect(screen.getByText('No worktrees match.')).toBeInTheDocument()
  })
})
