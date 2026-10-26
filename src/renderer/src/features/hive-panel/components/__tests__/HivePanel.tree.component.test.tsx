import { SessionId } from '@shared/types/brand'
import type { SessionSummary } from '@shared/types/session'
import { act, fireEvent, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
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

import { hivePage, summary, workerLineage } from './hive-panel.test-utils'

function child(
  id: string,
  parent: string,
  createdAt: number,
  overrides: Partial<SessionSummary> & { readonly state?: string } = {},
): SessionSummary {
  const { state, ...rest } = overrides
  return summary(id, {
    createdAt,
    lineage: {
      ...workerLineage,
      parentSessionId: SessionId(parent),
      parentTitle: parent,
      delegationState:
        state === 'needs_attention' ||
        state === 'ready_for_review' ||
        state === 'accepted' ||
        state === 'revision_requested'
          ? state
          : 'working',
    },
    ...rest,
  })
}

/** Queen → a, b; a → a1 (needs attention), a2 (archived); b → b1, b2 (ready for review). */
const threeLevelHive = [
  child('b2', 'b', 9, { state: 'ready_for_review' }),
  child('a2', 'a', 6, { state: 'accepted', archived: true }),
  child('b', 'queen', 2),
  child('a1', 'a', 5, { state: 'needs_attention' }),
  child('a', 'queen', 1),
  child('b1', 'b', 8),
]

function treeItems() {
  return within(screen.getByRole('tree', { name: 'Hive' })).getAllByRole('treeitem')
}

function item(name: string) {
  return screen.getByRole('treeitem', { name: new RegExp(`Session: ${name}\\b`, 'u') })
}

async function renderHive(members: readonly SessionSummary[] = threeLevelHive) {
  listHiveTreeSessionCatalogPage.mockResolvedValue(hivePage(members))
  const view = renderWithQueryClient(<HivePanel sessionId="queen" onClose={vi.fn()} />)
  await screen.findByRole('treeitem', { name: /Session: queen\b/u })
  return view
}

describe('HivePanel tree view', () => {
  beforeEach(() => {
    listHiveTreeSessionCatalogPage.mockReset()
    useNavigate.mockReset().mockResolvedValue(undefined)
    registerSidebarSessionActions(null)
    useHivePanelViewStore.setState({ view: 'tree', showArchived: false, collapsed: {} })
  })

  it('lists every Worker under its parent as a WAI-ARIA tree', async () => {
    await renderHive()

    expect(
      treeItems().map((row) => [row.getAttribute('aria-level'), row.getAttribute('aria-label')]),
    ).toEqual([
      ['1', expect.stringMatching(/^Open Queen Session: queen,/u)],
      ['2', expect.stringMatching(/^Open Worker Session: a, spawned by queen,/u)],
      [
        '3',
        expect.stringMatching(/^Open Worker Session: a1, spawned by a, state Needs attention/u),
      ],
      ['2', expect.stringMatching(/^Open Worker Session: b, spawned by queen,/u)],
      ['3', expect.stringMatching(/^Open Worker Session: b1, spawned by b,/u)],
      [
        '3',
        expect.stringMatching(/^Open Worker Session: b2, spawned by b, state Ready for review/u),
      ],
    ])
    expect(item('a')).toHaveAttribute('aria-expanded', 'true')
    expect(item('a')).toHaveAttribute('aria-setsize', '2')
    expect(item('b2')).toHaveAttribute('aria-posinset', '2')
    expect(item('b2')).not.toHaveAttribute('aria-expanded')
    // Archived Workers are hidden and counted on their parent.
    expect(item('a')).toHaveTextContent('1 Worker')
    expect(item('a')).toHaveTextContent('1 archived')
    expect(screen.queryByRole('treeitem', { name: /Session: a2\b/u })).toBeNull()
  })

  it('collapses a Worker, rolls up who needs the user, and remembers it', async () => {
    const view = await renderHive()

    fireEvent.click(within(item('a')).getByRole('button', { name: 'Collapse a' }))
    expect(item('a')).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('treeitem', { name: /Session: a1\b/u })).toBeNull()
    expect(within(item('a')).getByText('1 needs attention')).toBeInTheDocument()
    // The pointer-only disclosure hands focus back to its row, where the tree's keys work.
    expect(item('a')).toHaveFocus()

    view.unmount()
    await renderHive()
    expect(item('a')).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(within(item('a')).getByRole('button', { name: 'Expand a' }))
    expect(item('a1')).toBeInTheDocument()
  })

  it('brings archived Workers back in place, dimmed, with Show archived', async () => {
    await renderHive()

    const toggle = screen.getByRole('button', { name: 'Show archived' })
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-pressed', 'true')
    expect(treeItems().map((row) => row.getAttribute('aria-label')?.split(',')[0])).toContain(
      'Open Worker Session: a2',
    )
    expect(item('a2')).toHaveAttribute('data-dimmed', 'true')
    expect(item('a')).not.toHaveTextContent('archived')
  })

  it('moves and expands with the arrow keys and opens with Enter', async () => {
    await renderHive()
    const queenRow = item('queen')
    expect(queenRow).toHaveAttribute('tabindex', '0')
    act(() => queenRow.focus())

    fireEvent.keyDown(queenRow, { key: 'ArrowDown' })
    expect(item('a')).toHaveFocus()
    fireEvent.keyDown(item('a'), { key: 'ArrowRight' })
    expect(item('a1')).toHaveFocus()
    fireEvent.keyDown(item('a1'), { key: 'ArrowLeft' })
    expect(item('a')).toHaveFocus()
    fireEvent.keyDown(item('a'), { key: 'ArrowLeft' })
    expect(item('a')).toHaveAttribute('aria-expanded', 'false')
    fireEvent.keyDown(item('a'), { key: 'ArrowRight' })
    expect(item('a')).toHaveAttribute('aria-expanded', 'true')
    fireEvent.keyDown(item('a'), { key: 'End' })
    expect(item('b2')).toHaveFocus()
    fireEvent.keyDown(item('b2'), { key: 'Home' })
    expect(item('queen')).toHaveFocus()
    // Only the focused row is in the tab order.
    expect(item('b2')).toHaveAttribute('tabindex', '-1')

    fireEvent.keyDown(item('queen'), { key: 'ArrowDown' })
    fireEvent.keyDown(item('a'), { key: 'Enter' })
    expect(useNavigate).toHaveBeenCalledWith(
      expect.objectContaining({ params: { sessionId: 'a' } }),
    )
  })

  it('keeps a Worker whose parent is on a later page, then re-parents it', async () => {
    listHiveTreeSessionCatalogPage
      .mockResolvedValueOnce(hivePage([child('late-child', 'late-parent', 5)], 'cursor-1'))
      .mockResolvedValueOnce(hivePage([child('late-parent', 'queen', 1)]))
    renderWithQueryClient(<HivePanel sessionId="queen" onClose={vi.fn()} />)

    const orphan = await screen.findByRole('treeitem', { name: /Session: late-child\b/u })
    expect(orphan).toHaveAttribute('aria-level', '2')
    expect(orphan).toHaveTextContent('Spawned by late-parent (not loaded)')

    fireEvent.click(screen.getByRole('button', { name: 'Load more Workers' }))
    expect(await screen.findByRole('treeitem', { name: /Session: late-parent\b/u })).toBeVisible()
    expect(item('late-child')).toHaveAttribute('aria-level', '3')
    expect(item('late-child')).not.toHaveTextContent('not loaded')
  })

  it('keeps the state-grouped view as By state, linking each deeper row to its parent', async () => {
    await renderHive()

    const byState = screen.getByRole('button', { name: 'By state' })
    fireEvent.click(byState)
    expect(byState).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByRole('tree')).toBeNull()
    const deep = screen.getByRole('button', { name: /Open Worker Session: a1, spawned by a,/u })
    expect(deep).toHaveAttribute('title', 'queen › a › a1')
    // A direct Worker of the Queen has no link: its parent is the Queen row on top.
    expect(screen.queryByRole('button', { name: 'Spawned by queen' })).toBeNull()
    const [link] = screen.getAllByRole('button', { name: 'Spawned by a' })
    if (!link) throw new Error('Expected a Spawned by link')
    fireEvent.click(link)
    expect(
      screen.getByRole('button', { name: /Open Worker Session: a, spawned by queen,/u }),
    ).toHaveFocus()
  })
})
