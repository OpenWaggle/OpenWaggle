import { SessionId } from '@shared/types/brand'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useSessionStatusStore } from '@/features/sessions/state'
import { registerSidebarSessionActions } from '@/features/sidebar/lib'
import { renderWithQueryClient } from '@/test-utils/query-test-utils'
import { useHivePanelViewStore } from '../../state/hive-panel-view-store'

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
    // These cover the By next actor view; the tree view has its own tests.
    useHivePanelViewStore.setState({ view: 'by-next-actor', showArchived: false, collapsed: {} })
    listHiveTreeSessionCatalogPage.mockReset().mockResolvedValue(hivePage([]))
    useNavigate.mockReset().mockResolvedValue(undefined)
    registerSidebarSessionActions(null)
  })

  it('groups members by who acts next, each row saying why (#380)', async () => {
    const worker = (
      id: string,
      lineage: Partial<typeof workerLineage>,
      overrides: Parameters<typeof summary>[1] = {},
    ) => summary(id, { lineage: { ...workerLineage, ...lineage }, ...overrides })
    listHiveTreeSessionCatalogPage.mockResolvedValue(
      hivePage([
        worker('approval', { delegationState: 'working' }, { pendingInteractionKind: 'approval' }),
        worker('question', { delegationState: 'working' }, { pendingInteractionKind: 'question' }),
        worker('stuck', {
          delegationState: 'needs_attention',
          attentionCause: 'run_failed',
          parentWillAct: false,
        }),
        worker('review', { delegationState: 'ready_for_review', parentWillAct: false }),
        worker('failed', {
          delegationState: 'needs_attention',
          attentionCause: 'run_failed',
          parentWillAct: true,
        }),
        worker('asked', {
          delegationState: 'needs_attention',
          attentionCause: 'worker_request',
          parentWillAct: true,
        }),
        worker('turn', { delegationState: 'waiting' }),
        worker('active', { delegationState: 'working' }),
        worker('revising', { delegationState: 'revision_requested' }),
        worker('done', { delegationState: 'accepted' }),
        worker('dropped', { delegationState: 'cancelled' }),
        worker('archived', { delegationState: 'working' }, { archived: true }),
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
    const rowsOf = (group: string) =>
      within(screen.getByRole('group', { name: `${group} Hive sessions` }))
        .getAllByRole('button', { name: /^Open Worker Session/ })
        .map((row) => row.getAttribute('aria-label'))
    const label = (id: string) =>
      screen.getByRole('button', { name: new RegExp(`Open Worker Session: ${id},`) })
    expect(rowsOf('Needs you')).toEqual([
      expect.stringContaining('approval'),
      expect.stringContaining('question'),
      expect.stringContaining('stuck'),
    ])
    expect(label('approval')).toHaveTextContent('Waiting for your approval')
    expect(label('question')).toHaveTextContent('Waiting for your answer')
    expect(label('stuck')).toHaveTextContent('Stuck — no agent will pick it up')
    expect(rowsOf('Waiting for queen')).toHaveLength(4)
    expect(label('review')).toHaveTextContent('Ready for review')
    expect(label('failed')).toHaveTextContent('Run failed, queen notified')
    expect(label('asked')).toHaveTextContent('Asked queen for help')
    expect(label('turn')).toHaveTextContent('Finished its turn')
    expect(rowsOf('Working')).toHaveLength(2)
    expect(label('revising')).toHaveTextContent('Revising')
    expect(rowsOf('Closed')).toHaveLength(2)
    expect(label('dropped')).toHaveTextContent('Cancelled')
    // "Needs attention" and the bare "You" are not Hive words any more.
    expect(screen.queryByText(/Needs attention/)).toBeNull()
    expect(screen.queryByText('You')).toBeNull()
    // The header names its scope: every Worker of the Hive, at every depth.
    expect(screen.getByText('12 Workers in this Hive')).toBeInTheDocument()
    // The current Session is marked, and each row's name carries its cells for screen readers.
    const current = label('active')
    expect(current).toHaveAttribute('aria-current', 'true')
    expect(current).toHaveAccessibleName(
      'Open Worker Session: active, spawned by queen, state Working, workspace Checkout',
    )
    // Collapsed: the archived list is hidden from the accessibility tree.
    expect(screen.queryByRole('group', { name: 'Archived Hive sessions' })).toBeNull()
    expect(screen.getByText('Archived · 1')).toBeInTheDocument()
  })

  it('moves the Queen into Needs you while her own request waits (#380)', async () => {
    listHiveTreeSessionCatalogPage.mockResolvedValue({
      ...hivePage([summary('active')]),
      root: { ...queen, pendingInteractionKind: 'approval' },
    })
    renderWithQueryClient(<HivePanel sessionId="active" onClose={vi.fn()} />)

    const needsYou = await screen.findByRole('group', { name: 'Needs you Hive sessions' })
    const queenRow = within(needsYou).getByRole('button', { name: /Open Queen Session: queen/ })
    expect(queenRow).toHaveTextContent('Waiting for your approval')
    // Listed once: in Needs you, not also on top.
    expect(screen.getAllByRole('button', { name: /Open Queen Session: queen/ })).toHaveLength(1)
  })

  it('follows the live status for a parked request between Hive reads', async () => {
    listHiveTreeSessionCatalogPage.mockResolvedValue(hivePage([summary('live')]))
    useSessionStatusStore.getState().setStatus(SessionId('live'), 'awaiting-input', 10)
    renderWithQueryClient(<HivePanel sessionId="queen" onClose={vi.fn()} />)

    const needsYou = await screen.findByRole('group', { name: 'Needs you Hive sessions' })
    expect(within(needsYou).getByRole('button', { name: /live/ })).toHaveTextContent(
      'Waiting for your answer',
    )
    useSessionStatusStore.getState().clearStatus(SessionId('live'))
  })

  it('presents the root as the Queen even when it has no lineage row of its own', async () => {
    // A top-level Queen never spawned as a Worker has no session_spawn_lineage row, so its
    // summary carries no lineage role; the hive root is still the Queen (ADR 0030).
    listHiveTreeSessionCatalogPage.mockResolvedValue({
      root: summary('queen', { lineage: undefined }),
      members: [summary('active', { lineage: { ...workerLineage, delegationState: 'working' } })],
      needsYouCount: 0,
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

  it('names deeper members’ parents and navigates with the panel kept', async () => {
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
    // The parent is named beside the row, never truncated with the title (#356, #377); this one
    // is on a page not read yet, so it is not a link.
    expect(within(row).getByText('deep')).toHaveClass('line-clamp-2')
    expect(row).toHaveAccessibleName(/^Open Worker Session: deep, spawned by Mid worker,/u)
    expect(screen.getByText('Spawned by Mid worker (not loaded)')).toBeInTheDocument()
    fireEvent.click(row)
    expect(useNavigate).toHaveBeenCalled()
    expect(useNavigate.mock.calls[0]?.[0]?.search({ panel: 'diff' })).toMatchObject({
      panel: 'hive',
    })
  })

  it('pages members with a load-more control', async () => {
    listHiveTreeSessionCatalogPage
      .mockResolvedValueOnce(
        hivePage([summary('one'), summary('old', { archived: true })], 'cursor-1'),
      )
      .mockResolvedValueOnce(hivePage([summary('two')]))
    renderWithQueryClient(<HivePanel sessionId="queen" onClose={vi.fn()} />)

    // Counts of a partly read Hive are lower bounds, as in the Session Summary.
    expect(await screen.findByText('2+ Workers in this Hive')).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Working Hive sessions' })).toHaveTextContent('1+')
    expect(screen.getByText('Archived · 1+')).toBeInTheDocument()
    fireEvent.click(await screen.findByRole('button', { name: 'Load more Workers' }))
    expect(
      await screen.findByRole('button', { name: /Open Worker Session: two/ }),
    ).toBeInTheDocument()
    expect(screen.getByText('3 Workers in this Hive')).toBeInTheDocument()
    expect(screen.getByText('Archived · 1')).toBeInTheDocument()
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
