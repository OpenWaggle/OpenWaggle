import { SessionId } from '@shared/types/brand'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { registerSidebarSessionActions } from '@/features/sidebar/lib'
import { Button } from '@/shared/ui/Button'
import { useUIStore } from '@/shell/ui-store'
import { renderWithQueryClient } from '@/test-utils/query-test-utils'
import { useHivePanelViewStore } from '../../state/hive-panel-view-store'

const listHiveTreeSessionCatalogPage = vi.hoisted(() => vi.fn())
const unarchiveSession = vi.hoisted(() => vi.fn())
type NavigateOptions = {
  to: string
  params: Record<string, string>
  search: (previous: Record<string, unknown>) => Record<string, unknown>
}
const useNavigate = vi.hoisted(() => vi.fn<(options: NavigateOptions) => Promise<unknown>>())

vi.mock('@/shared/lib/ipc', () => ({ api: { listHiveTreeSessionCatalogPage, unarchiveSession } }))
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useNavigate: () => useNavigate,
}))

import { HivePanel } from '../HivePanel'

import { hivePage, sessionActionsStub, summary, workerLineage } from './hive-panel.test-utils'

describe('HivePanel archived group', () => {
  beforeEach(() => {
    // These cover the By state view; the tree view has its own tests.
    useHivePanelViewStore.setState({ view: 'by-state', showArchived: false, collapsed: {} })
    listHiveTreeSessionCatalogPage.mockReset().mockResolvedValue(hivePage([]))
    unarchiveSession.mockReset()
    useNavigate.mockReset().mockResolvedValue(undefined)
    registerSidebarSessionActions(null)
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
    const actions = sessionActionsStub()
    registerSidebarSessionActions(actions)
    renderWithQueryClient(<HivePanel sessionId="queen" onClose={vi.fn()} />)

    expect(
      await screen.findByRole('button', { name: 'Open session actions for live' }),
    ).toBeInTheDocument()
    // Archived rows live in the collapsed group; expanding it exposes the row and its menu.
    const archivedToggle = screen.getByRole('button', { name: 'Archived · 1' })
    expect(archivedToggle).toHaveAttribute('aria-expanded', 'false')
    // The controlled list exists while collapsed, so aria-controls never dangles.
    expect(
      document.getElementById(archivedToggle.getAttribute('aria-controls') ?? ''),
    ).not.toBeNull()
    fireEvent.click(archivedToggle)
    expect(archivedToggle).toHaveAttribute('aria-expanded', 'true')
    expect(
      document.getElementById(archivedToggle.getAttribute('aria-controls') ?? ''),
    ).toHaveAccessibleName('Archived Hive sessions')
    fireEvent.click(screen.getByRole('button', { name: 'Open session actions for archived' }))
    expect(await screen.findByRole('button', { name: 'Unarchive session' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Archive session' })).toBeNull()

    registerSidebarSessionActions(null)
  })

  it('collapses the archived group again when another Hive opens', async () => {
    const otherQueen = summary('other-queen', {
      lineage: { role: 'queen', directWorkerCount: 1, activeDirectWorkerCount: 0 },
    })
    const archived = (id: string, root: string) =>
      summary(id, {
        archived: true,
        lineage: {
          ...workerLineage,
          parentSessionId: SessionId(root),
          hiveRootSessionId: SessionId(root),
          delegationState: 'accepted',
        },
      })
    listHiveTreeSessionCatalogPage.mockImplementation((id: string) =>
      Promise.resolve(
        id === 'queen'
          ? hivePage([archived('old-a', 'queen')])
          : { root: otherQueen, members: [archived('old-b', 'other-queen')], needsYouCount: 0 },
      ),
    )
    function Switcher() {
      const [sessionId, setSessionId] = useState('queen')
      return (
        <>
          <Button variant="unstyled" onClick={() => setSessionId('other-queen')}>
            Switch Hive
          </Button>
          <HivePanel sessionId={sessionId} onClose={vi.fn()} />
        </>
      )
    }
    renderWithQueryClient(<Switcher />)

    fireEvent.click(await screen.findByRole('button', { name: 'Archived · 1' }))
    expect(screen.getByRole('button', { name: 'Archived · 1' })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
    fireEvent.click(screen.getByRole('button', { name: 'Switch Hive' }))
    expect(
      await screen.findByRole('button', { name: /Open Queen Session: other-queen/ }),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Archived · 1' })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
  })

  it('explains a refused Unarchive and keeps the row archived', async () => {
    unarchiveSession.mockRejectedValue(new Error('Host unavailable'))
    listHiveTreeSessionCatalogPage.mockResolvedValue(
      hivePage([
        summary('archived', {
          archived: true,
          lineage: { ...workerLineage, delegationState: 'accepted' },
        }),
      ]),
    )
    registerSidebarSessionActions(sessionActionsStub())
    renderWithQueryClient(<HivePanel sessionId="queen" onClose={vi.fn()} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Archived · 1' }))
    fireEvent.click(screen.getByRole('button', { name: 'Open session actions for archived' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Unarchive session' }))

    await waitFor(() =>
      expect(useUIStore.getState().toastData).toMatchObject({
        message: 'Unable to unarchive archived: Host unavailable',
        variant: 'error',
      }),
    )
    expect(unarchiveSession).toHaveBeenCalledWith(SessionId('archived'))
    expect(screen.getByRole('button', { name: 'Archived · 1' })).toBeInTheDocument()
    registerSidebarSessionActions(null)
  })
})
