import { fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { renderWithQueryClient } from '@/test-utils/query-test-utils'
import {
  createPreferencesMock,
  createWorktreeApiMocks,
  entry,
  inventory,
  OTHER_PROJECT,
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
