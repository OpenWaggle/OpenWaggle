import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { renderWithQueryClient } from '@/test-utils/query-test-utils'
import {
  createPreferencesMock,
  createWorktreeApiMocks,
  entry,
  inventory,
  OTHER_PROJECT,
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

beforeEach(() => {
  api = createWorktreeApiMocks()
  Object.assign(mocks.api, api)
  Object.assign(mocks.preferences, createPreferencesMock())
})

it('drops the project filter when that project leaves the list', async () => {
  const mine = entry({ path: '/wt/mine' })
  api.getWorktreeInventory.mockResolvedValue(
    inventory([mine, entry({ path: '/wt/theirs', projectPath: OTHER_PROJECT })]),
  )
  renderWithQueryClient(<WorktreesSection />)
  await rowTitled('mine')
  fireEvent.change(screen.getByRole('combobox', { name: 'Project' }), {
    target: { value: OTHER_PROJECT },
  })
  await waitFor(() => expect(screen.queryByText('mine')).not.toBeInTheDocument())

  // Its last worktree is removed: the refreshed list no longer names the project.
  const refreshed = inventory([mine])
  api.getWorktreeInventory.mockResolvedValue({
    ...refreshed,
    projects: refreshed.projects.filter((project) => project.projectPath !== OTHER_PROJECT),
  })
  const row = await rowTitled('theirs')
  fireEvent.click(row.getByRole('button', { name: 'Remove theirs' }))
  fireEvent.click(row.getByRole('button', { name: 'Confirm remove theirs' }))

  expect(await rowTitled('mine')).toBeTruthy()
  expect(screen.queryByRole('combobox', { name: 'Project' })).not.toBeInTheDocument()
})

it('cancels a row’s inline confirmation once Free starts removing it', async () => {
  api.getWorktreeInventory.mockResolvedValue(inventory([entry({ path: '/wt/free' })]))
  let refuse: () => void = () => undefined
  api.removeGitWorktree.mockReturnValue(
    new Promise((resolve) => {
      refuse = () => resolve({ ok: false, code: 'dirty-worktree', message: 'It changed.' })
    }),
  )
  renderWithQueryClient(<WorktreesSection />)

  const row = await rowTitled('free')
  fireEvent.click(row.getByRole('button', { name: 'Remove free' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Free about 1.0 MB (1)…' }))
  const dialog = await screen.findByRole('dialog')
  fireEvent.click(within(dialog).getByRole('button', { name: 'Remove 1 worktree' }))

  expect(await row.findByRole('button', { name: 'Removing free' })).toBeInTheDocument()
  expect(row.queryByRole('button', { name: 'Confirm remove free' })).not.toBeInTheDocument()

  // Free fails for it: the row comes back with Remove, not one click from removal.
  refuse()
  expect(await row.findByRole('button', { name: 'Remove free' })).toBeInTheDocument()
  expect(row.queryByRole('button', { name: 'Confirm remove free' })).not.toBeInTheDocument()
})

it('archives the Sessions of a worktree with changes, and keeps the worktree', async () => {
  const session = {
    sessionId: 'open',
    title: 'Half done',
    archived: false,
    archivedAt: null,
    running: false,
    owner: true,
  }
  api.getWorktreeInventory.mockResolvedValue(
    inventory([
      entry({
        path: '/wt/dirty',
        group: 'in-use',
        sessions: [session],
        uncommittedChangeCount: 2,
        attention: [
          { kind: 'open-sessions', count: 1 },
          { kind: 'uncommitted-changes', count: 2 },
        ],
      }),
    ]),
  )
  api.manageProjectActions.mockImplementation(async (request) =>
    preview(request, { usage: { path: '/wt/dirty', sessions: [session], blockers: [] } }),
  )
  renderWithQueryClient(<WorktreesSection />)

  fireEvent.click(await screen.findByRole('button', { name: /In use/ }))
  fireEvent.click(
    (await rowTitled('Half done')).getByRole('button', { name: 'Archive Sessions Half done…' }),
  )
  const dialog = await screen.findByRole('dialog', { name: 'Archive its Sessions?' })
  expect(dialog).toHaveTextContent('so it is kept')
  const confirm = within(dialog).getByRole('button', { name: 'Archive Sessions' })
  await waitFor(() => expect(confirm).toBeEnabled())
  fireEvent.click(confirm)

  // No force: the Host keeps a worktree with changes, so nothing is discarded.
  await waitFor(() =>
    expect(api.archiveAndRemoveWorktree).toHaveBeenCalledWith(PROJECT, {
      path: '/wt/dirty',
      sessionIds: ['open'],
    }),
  )
})
