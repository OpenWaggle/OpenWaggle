import { SessionId } from '@shared/types/brand'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { registerSidebarSessionActions } from '@/features/sidebar/lib'
import { renderWithQueryClient } from '@/test-utils/query-test-utils'

const listHiveTreeSessionCatalogPage = vi.hoisted(() => vi.fn())
type NavigateOptions = {
  to: string
  params: Record<string, string>
  search: (previous: Record<string, unknown>) => Record<string, unknown>
}
const useNavigate = vi.hoisted(() => vi.fn<(options: NavigateOptions) => Promise<unknown>>())

vi.mock('@/shared/lib/ipc', () => ({ api: { listHiveTreeSessionCatalogPage } }))
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useNavigate: () => useNavigate,
}))

import { HivePanel } from '../HivePanel'

import {
  hivePage,
  queen,
  sessionActionsStub,
  summary,
  workerLineage,
} from './hive-panel.test-utils'

describe('HivePanel', () => {
  beforeEach(() => {
    listHiveTreeSessionCatalogPage.mockReset().mockResolvedValue(hivePage([]))
    useNavigate.mockReset().mockResolvedValue(undefined)
    registerSidebarSessionActions(null)
  })

  it('lists the Queen and grouped members, highlighting the current session', async () => {
    listHiveTreeSessionCatalogPage.mockResolvedValue(
      hivePage([
        summary('needs-you', {
          lineage: { ...workerLineage, delegationState: 'needs_attention' },
        }),
        summary('active', { lineage: { ...workerLineage, delegationState: 'working' } }),
        summary('done', { lineage: { ...workerLineage, delegationState: 'accepted' } }),
        summary('archived', {
          archived: true,
          lineage: { ...workerLineage, delegationState: 'working' },
        }),
      ]),
    )
    renderWithQueryClient(<HivePanel sessionId="active" onClose={vi.fn()} />)

    expect(
      await screen.findByRole('button', { name: /Open Queen Session: queen/ }),
    ).toBeInTheDocument()
    // One column header anchors the Workspace and State cells (ADR 0051 review).
    expect(screen.getByText('Session')).toBeInTheDocument()
    expect(screen.getByText('Workspace')).toBeInTheDocument()
    expect(screen.getByText('State')).toBeInTheDocument()
    // The State cell names the Delegation state with the same words as its group (#356).
    const needsAttention = screen.getByRole('button', { name: /Open Worker Session: needs-you/ })
    expect(needsAttention).toHaveTextContent('Needs attention')
    expect(screen.queryByText('You')).toBeNull()
    // The header names its scope: every Worker of the Hive, at every depth.
    expect(screen.getByText('4 Workers in this Hive')).toBeInTheDocument()
    // The current Session is marked, and each row's name carries its cells for screen readers.
    const current = screen.getByRole('button', { name: /Open Worker Session: active/ })
    expect(current).toHaveAttribute('aria-current', 'true')
    expect(current).toHaveAccessibleName(
      'Open Worker Session: active, state Working, workspace Checkout',
    )
    expect(screen.getByRole('group', { name: 'Needs attention Hive sessions' })).toHaveTextContent(
      'needs-you',
    )
    expect(screen.getByRole('group', { name: 'Active Hive sessions' })).toHaveTextContent('active')
    expect(screen.getByRole('group', { name: 'Closed Hive sessions' })).toHaveTextContent('done')
    expect(screen.queryByRole('group', { name: 'Done Hive sessions' })).toBeNull()
    // Collapsed: the archived list is hidden from the accessibility tree.
    expect(screen.queryByRole('group', { name: 'Archived Hive sessions' })).toBeNull()
    expect(screen.getByText('Archived · 1')).toBeInTheDocument()
  })

  it('presents the root as the Queen even when it has no lineage row of its own', async () => {
    // A top-level Queen never spawned as a Worker has no session_spawn_lineage row, so its
    // summary carries no lineage role; the hive root is still the Queen (ADR 0030).
    listHiveTreeSessionCatalogPage.mockResolvedValue({
      root: summary('queen', { lineage: undefined }),
      members: [summary('active', { lineage: { ...workerLineage, delegationState: 'working' } })],
      attentionCount: 0,
    })
    renderWithQueryClient(<HivePanel sessionId="elsewhere" onClose={vi.fn()} />)

    expect(
      await screen.findByRole('button', { name: /Open Queen Session: queen/ }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Open Worker Session: queen/ })).toBeNull()
  })

  it('renames a row in place from its menu', async () => {
    listHiveTreeSessionCatalogPage.mockResolvedValue(hivePage([summary('live')]))
    registerSidebarSessionActions(sessionActionsStub())
    renderWithQueryClient(<HivePanel sessionId="queen" onClose={vi.fn()} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Open session actions for live' }))
    fireEvent.click(screen.getByRole('button', { name: 'Rename session' }))

    const input = await screen.findByRole('textbox', { name: 'Session title' })
    expect(input).toHaveValue('live')
    expect(screen.queryByRole('button', { name: /Open Worker Session: live/ })).toBeNull()
    // The row's actions step aside while the input owns the row.
    expect(screen.queryByRole('button', { name: 'Open session actions for live' })).toBeNull()
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(
      await screen.findByRole('button', { name: /Open Worker Session: live/ }),
    ).toBeInTheDocument()
    registerSidebarSessionActions(null)
  })

  it('labels deeper members via their parent and navigates with the panel kept', async () => {
    listHiveTreeSessionCatalogPage.mockResolvedValue(
      hivePage([
        summary('deep', {
          lineage: {
            ...workerLineage,
            parentSessionId: SessionId('mid'),
            parentTitle: 'Mid worker',
          },
        }),
      ]),
    )
    renderWithQueryClient(<HivePanel sessionId="queen" onClose={vi.fn()} />)

    const row = await screen.findByRole('button', { name: /Open Worker Session: deep/ })
    // Depth is its own visible line, so a long title cannot truncate it away (#356).
    expect(within(row).getByText('deep')).toHaveClass('line-clamp-2')
    expect(within(row).getByText('via Mid worker')).not.toBe(within(row).getByText('deep'))
    fireEvent.click(row)
    expect(useNavigate).toHaveBeenCalled()
    expect(useNavigate.mock.calls[0]?.[0]?.search({ panel: 'diff' })).toMatchObject({
      panel: 'hive',
    })
  })

  it('pages members with a load-more control', async () => {
    listHiveTreeSessionCatalogPage
      .mockResolvedValueOnce(hivePage([summary('one')], 'cursor-1'))
      .mockResolvedValueOnce(hivePage([summary('two')]))
    renderWithQueryClient(<HivePanel sessionId="queen" onClose={vi.fn()} />)

    // Counts of a partly read Hive are lower bounds, as in the Session Summary.
    expect(await screen.findByText('1+ Workers in this Hive')).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Active Hive sessions' })).toHaveTextContent('1+')
    fireEvent.click(await screen.findByRole('button', { name: 'Load more Workers' }))
    expect(
      await screen.findByRole('button', { name: /Open Worker Session: two/ }),
    ).toBeInTheDocument()
    expect(screen.getByText('2 Workers in this Hive')).toBeInTheDocument()
  })

  it('keeps loaded rows and retries only the page that failed', async () => {
    listHiveTreeSessionCatalogPage
      .mockResolvedValueOnce(hivePage([summary('one')], 'cursor-1'))
      .mockRejectedValueOnce(new Error('Host unavailable'))
      .mockResolvedValueOnce(hivePage([summary('two')]))
    renderWithQueryClient(<HivePanel sessionId="queen" onClose={vi.fn()} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Load more Workers' }))
    const retry = await screen.findByRole('button', {
      name: 'Could not load more Workers \u2014 Retry',
    })
    // The first page stays, with no initial-load alert competing with the page retry.
    expect(screen.getByRole('button', { name: /Open Worker Session: one/ })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
    fireEvent.click(retry)
    expect(
      await screen.findByRole('button', { name: /Open Worker Session: two/ }),
    ).toBeInTheDocument()
    expect(listHiveTreeSessionCatalogPage).toHaveBeenLastCalledWith(queen.id, 50, 'cursor-1')
  })

  it('marks the Queen row current and says when the Hive has no Workers', async () => {
    listHiveTreeSessionCatalogPage.mockResolvedValue(hivePage([]))
    renderWithQueryClient(<HivePanel sessionId="queen" onClose={vi.fn()} />)

    expect(
      await screen.findByRole('button', { name: /Open Queen Session: queen/ }),
    ).toHaveAttribute('aria-current', 'true')
    expect(await screen.findByText('No Workers yet.')).toBeInTheDocument()
  })

  it('hides the menu affordance before a Sidebar registers actions', async () => {
    renderWithQueryClient(<HivePanel sessionId="queen" onClose={vi.fn()} />)
    expect(await screen.findByRole('region', { name: 'Hive' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Open session actions/ })).toBeNull()
  })

  it('offers a retry when the Hive cannot load', async () => {
    listHiveTreeSessionCatalogPage.mockRejectedValue(new Error('Host unavailable'))
    renderWithQueryClient(<HivePanel sessionId="queen" onClose={vi.fn()} />)

    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to load this Hive.')
    listHiveTreeSessionCatalogPage.mockResolvedValue(hivePage([]))
    fireEvent.click(screen.getByRole('button', { name: 'Retry Hive' }))
    expect(await screen.findByRole('region', { name: 'Hive' })).toBeInTheDocument()
  })

  it('waits for a Session id before querying', async () => {
    renderWithQueryClient(<HivePanel sessionId={null} onClose={vi.fn()} />)
    await waitFor(() => expect(listHiveTreeSessionCatalogPage).not.toHaveBeenCalled())
  })
})
