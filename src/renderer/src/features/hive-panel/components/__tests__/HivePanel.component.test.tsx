import { SessionId } from '@shared/types/brand'
import type { SessionLineageSummary, SessionSummary } from '@shared/types/session'
import { fireEvent, screen, waitFor } from '@testing-library/react'
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

function summary(id: string, overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id: SessionId(id),
    title: id,
    projectPath: '/project',
    createdAt: 1000,
    updatedAt: 1000,
    lineage: {
      role: 'worker',
      parentSessionId: SessionId('queen'),
      hiveRootSessionId: SessionId('queen'),
      parentTitle: 'queen',
      directWorkerCount: 0,
      activeDirectWorkerCount: 0,
      delegationState: 'working',
    },
    ...overrides,
  }
}

const queen = summary('queen', {
  lineage: {
    role: 'queen',
    hiveRootSessionId: SessionId('queen'),
    directWorkerCount: 2,
    activeDirectWorkerCount: 1,
  },
})

// The Workers share one lineage base.
const workerLineage: SessionLineageSummary = {
  role: 'worker',
  parentSessionId: SessionId('queen'),
  hiveRootSessionId: SessionId('queen'),
  parentTitle: 'queen',
  directWorkerCount: 0,
  activeDirectWorkerCount: 0,
}

function hivePage(members: readonly SessionSummary[], nextCursor?: string) {
  return { root: queen, members, ...(nextCursor ? { nextCursor } : {}) }
}

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
    // One column header anchors the Workspace and State cells (ADR 0050 review).
    expect(screen.getByText('Session')).toBeInTheDocument()
    expect(screen.getByText('Workspace')).toBeInTheDocument()
    expect(screen.getByText('State')).toBeInTheDocument()
    // The State cell uses the group's short form.
    expect(screen.getByText('You')).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Needs you Hive sessions' })).toHaveTextContent(
      'needs-you',
    )
    expect(screen.getByRole('group', { name: 'Active Hive sessions' })).toHaveTextContent('active')
    expect(screen.getByRole('group', { name: 'Done Hive sessions' })).toHaveTextContent('done')
    expect(screen.queryByLabelText('Archived Hive sessions')).toBeNull()
    expect(screen.getByText('Archived · 1')).toBeInTheDocument()
  })

  it('presents the root as the Queen even when it has no lineage row of its own', async () => {
    // A top-level Queen never spawned as a Worker has no session_spawn_lineage row, so its
    // summary carries no lineage role; the hive root is still the Queen (ADR 0030).
    const xLineage = summary('x').lineage
    listHiveTreeSessionCatalogPage.mockResolvedValue({
      root: summary('queen', { lineage: undefined }),
      members: [summary('active', { lineage: { ...xLineage, delegationState: 'working' } })],
    })
    renderWithQueryClient(<HivePanel sessionId="elsewhere" onClose={vi.fn()} />)

    expect(
      await screen.findByRole('button', { name: /Open Queen Session: queen/ }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Open Worker Session: queen/ })).toBeNull()
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
    expect(row).toHaveTextContent('via Mid worker')
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

    fireEvent.click(await screen.findByRole('button', { name: 'Load more Workers' }))
    expect(
      await screen.findByRole('button', { name: /Open Worker Session: two/ }),
    ).toBeInTheDocument()
  })

  it('offers the sidebar session menu, with Unarchive for an archived row', async () => {
    listHiveTreeSessionCatalogPage.mockResolvedValue(
      hivePage([
        summary('live'),
        summary('archived', {
          archived: true,
          lineage: { ...workerLineage, delegationState: 'accepted' },
        }),
      ]),
    )
    const actions = {
      select: vi.fn(),
      delete: vi.fn(),
      archive: vi.fn(),
      markUnread: vi.fn(),
      clone: vi.fn(),
      togglePin: vi.fn(),
    }
    registerSidebarSessionActions(actions)
    renderWithQueryClient(<HivePanel sessionId="queen" onClose={vi.fn()} />)

    expect(
      await screen.findByRole('button', { name: 'Open session actions for live' }),
    ).toBeInTheDocument()
    // Archived rows live in the collapsed group; expanding it exposes the row and its menu.
    fireEvent.click(screen.getByRole('button', { name: 'Expand archived Workers' }))
    fireEvent.click(screen.getByRole('button', { name: 'Open session actions for archived' }))
    expect(await screen.findByRole('button', { name: 'Unarchive session' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Archive session' })).toBeNull()

    registerSidebarSessionActions(null)
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
