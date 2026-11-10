import { fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { renderWithQueryClient } from '@/test-utils/query-test-utils'
import {
  createPreferencesMock,
  createWorktreeApiMocks,
  entry,
  inventory,
  MEGABYTE,
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

const loggerWarn = vi.hoisted(() => vi.fn())
vi.mock('@/shared/lib/logger', () => ({
  createRendererLogger: () => ({ warn: loggerWarn, info: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))

import { WorktreesSection } from '../WorktreesSection'

const DAY = 86_400_000

let api = createWorktreeApiMocks()
let preferences = createPreferencesMock()

function archivedDaysAgo(days: number) {
  return Date.now() - days * DAY
}

beforeEach(() => {
  api = createWorktreeApiMocks()
  preferences = createPreferencesMock()
  Object.assign(mocks.api, api)
  Object.assign(mocks.preferences, preferences)
  api.getWorktreeInventory.mockResolvedValue(
    inventory([
      entry({ path: '/wt/old', archivedAt: archivedDaysAgo(40) }),
      entry({ path: '/wt/recent', archivedAt: archivedDaysAgo(3) }),
      entry({
        path: '/wt/ahead',
        archivedAt: archivedDaysAgo(50),
        group: 'decide',
        attention: [{ kind: 'unpublished-commits', count: 1 }],
      }),
      // A worktree no Session uses is only ever removed by hand.
      entry({ path: '/wt/orphan' }),
    ]),
  )
})

it('is off until turned on, and previews what it would remove', async () => {
  renderWithQueryClient(<WorktreesSection />)

  const toggle = await screen.findByRole('switch', {
    name: 'Remove worktrees of archived Sessions automatically',
  })
  expect(toggle).not.toBeChecked()
  // The one removal without a confirmation says what it deletes.
  expect(screen.getByText(/deletes the files Git ignores in it, such as \.env/)).toBeInTheDocument()
  await waitFor(() =>
    expect(
      screen.getByText('Would remove 1 worktree (about 1.0 MB) now. 1 is kept to protect work.'),
    ).toBeInTheDocument(),
  )

  fireEvent.click(toggle)
  expect(preferences.setAutomaticWorktreeRemoval).toHaveBeenCalledWith({
    enabled: true,
    archivedDays: 30,
  })
})

it('previews a different number of days before it is saved', async () => {
  renderWithQueryClient(<WorktreesSection />)

  const days = await screen.findByRole('combobox', { name: 'After archiving for' })
  fireEvent.change(days, { target: { value: '60' } })
  expect(preferences.setAutomaticWorktreeRemoval).toHaveBeenCalledWith({
    enabled: false,
    archivedDays: 60,
  })
})

it('records the last check and the last removal, with its Sessions and branches', async () => {
  api.getAutomaticWorktreeRemovalLog.mockResolvedValue({
    lastCheckedAt: Date.now(),
    unannouncedRunIds: [],
    runs: [
      {
        id: 'run',
        startedAt: Date.now(),
        finishedAt: Date.now(),
        archivedDays: 30,
        removed: [
          {
            path: '/wt/gone',
            projectPath: '/project',
            branch: 'ow/gone',
            sessionTitles: ['Old experiment'],
            reclaimableBytes: 2 * MEGABYTE,
          },
        ],
        failed: [],
      },
    ],
  })
  renderWithQueryClient(<WorktreesSection />)

  expect(
    await screen.findByText(/Last removal .* · removed 1 worktree \(about 2\.0 MB\)/),
  ).toBeInTheDocument()
  expect(screen.getByText(/Old experiment · project · branch ow\/gone kept/)).toBeInTheDocument()
  expect(screen.getByText(/^Last checked /)).toBeInTheDocument()
})

it('counts each row down by the rule as it is now, rounding up', async () => {
  preferences.settings.automaticWorktreeRemoval = { enabled: true, archivedDays: 30 }
  // The Host decided with the rule off; the row follows the rule the page shows.
  api.getWorktreeInventory.mockResolvedValue(
    inventory([
      entry({
        path: '/wt/recent',
        archivedAt: archivedDaysAgo(20) + DAY / 2,
        automaticRemoval: { kind: 'not-applicable' },
      }),
    ]),
  )
  renderWithQueryClient(<WorktreesSection />)

  expect(await screen.findByText('Removed automatically in 11 days')).toBeInTheDocument()
})

it('settles a failed automatic-removal rule write instead of floating its rejection', async () => {
  // The card fires this Settings write with `void`, so a transient Settings IPC failure used
  // to surface as an unhandled renderer rejection (Sentry issue OPENWAGGLE-6).
  preferences.setAutomaticWorktreeRemoval.mockRejectedValue(
    new Error('connect ECONNREFUSED 127.0.0.1:443'),
  )
  renderWithQueryClient(<WorktreesSection />)

  const toggle = await screen.findByRole('switch', {
    name: 'Remove worktrees of archived Sessions automatically',
  })
  fireEvent.click(toggle)

  await waitFor(() =>
    expect(loggerWarn).toHaveBeenCalledWith('Failed to change automatic worktree removal', {
      error: expect.stringContaining('ECONNREFUSED'),
    }),
  )
})

it("settles a failed 'New Sessions run in' write instead of floating its rejection", async () => {
  // The Select fires this Settings write with `void`, so a transient Settings IPC failure used
  // to surface as an unhandled renderer rejection (Sentry issue OPENWAGGLE-6).
  preferences.setDefaultSessionEnvironmentMode.mockRejectedValue(
    new Error('connect ECONNREFUSED 127.0.0.1:443'),
  )
  renderWithQueryClient(<WorktreesSection />)

  const mode = await screen.findByRole('combobox', { name: 'New Sessions run in' })
  fireEvent.change(mode, { target: { value: 'worktree' } })

  await waitFor(() =>
    expect(loggerWarn).toHaveBeenCalledWith(
      'Failed to change the default Session environment mode',
      {
        error: expect.stringContaining('ECONNREFUSED'),
      },
    ),
  )
})
