import { fireEvent, render, screen, within } from '@testing-library/react'
import { Blocks, GitCompare, LayoutGrid } from 'lucide-react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RightPanelSurfaceId } from '@/shared/lib/right-panel-surfaces'
import type { RailExtensionPanel } from '../right-panel-extension-panels'
import type { RightPanelModel, RightPanelSurfaceEntry } from '../useRightPanelModel'

const mocks = vi.hoisted(() => {
  const model: Pick<RightPanelModel, 'surfaces'> = { surfaces: [] }
  return { model, navigate: vi.fn(), showSurface: vi.fn() }
})

vi.mock('@tanstack/react-router', () => ({ useNavigate: () => mocks.navigate }))
vi.mock('../useRightPanelModel', () => ({ useRightPanelModel: () => mocks.model }))
vi.mock('@/shared/lib/right-panel-surfaces', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/shared/lib/right-panel-surfaces')>()),
  showRightPanelSurface: mocks.showSurface,
  toggleRightPanelSurface: vi.fn(),
}))

import { AllPanelsSurface } from '../AllPanelsSurface'
import { useRightPanelRailStore } from '../right-panel-rail-store'

function entry(
  id: RightPanelSurfaceId,
  overrides: Partial<RightPanelSurfaceEntry> = {},
): RightPanelSurfaceEntry {
  return {
    id,
    title: id,
    description: id,
    glyph: { kind: 'lucide', icon: LayoutGrid },
    group: 'Workspace',
    shortcutLabel: null,
    disabledReason: null,
    needsLabel: null,
    extension: null,
    pinned: true,
    isNew: false,
    running: false,
    ...overrides,
  }
}

function extensionPanel(
  sidePanelId: string,
  status: RailExtensionPanel['status'],
): RailExtensionPanel {
  return {
    id: `extension:linear:${sidePanelId}`,
    extensionId: 'linear',
    extensionName: 'Linear',
    sidePanelId,
    title: sidePanelId,
    packagePath: '/extensions/linear',
    contentHash: 'hash',
    status,
  }
}

describe('AllPanelsSurface', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useRightPanelRailStore.setState({ overflowing: ['changes'] })
    mocks.model = {
      surfaces: [
        entry('all-panels', { group: null }),
        entry('changes', {
          title: 'Changes',
          glyph: { kind: 'lucide', icon: GitCompare },
          shortcutLabel: '⌘D',
        }),
        entry('session-tree', { title: 'Session Tree', group: 'Session', pinned: false }),
        entry('extension:linear:issues', {
          title: 'Issues',
          group: 'Extensions',
          glyph: { kind: 'lucide', icon: Blocks },
          extension: extensionPanel('issues', { kind: 'available' }),
          isNew: true,
        }),
        entry('extension:linear:triage', {
          title: 'Triage',
          group: 'Extensions',
          extension: extensionPanel('triage', {
            kind: 'needs',
            label: 'Needs trust',
            reason: 'Trust Linear to run this panel',
          }),
          needsLabel: 'Needs trust',
          disabledReason: 'Trust Linear to run this panel',
        }),
      ],
    }
  })

  it('groups surfaces and labels shortcuts, no room, New and what a panel needs', () => {
    render(<AllPanelsSurface />)
    const changes = screen.getByRole('button', { name: /^Changes/ })
    expect(within(changes).getByText('⌘D')).toBeVisible()
    expect(within(changes).getByText('No room on rail')).toBeVisible()
    expect(screen.getByRole('heading', { name: 'Session' })).toBeVisible()
    expect(screen.getByRole('heading', { name: 'Linear' })).toBeVisible()
    expect(within(screen.getByRole('button', { name: /^Issues/ })).getByText('New')).toBeVisible()
    const triage = screen.getByRole('button', { name: /^Triage/ })
    expect(triage).toHaveAttribute('aria-disabled', 'true')
    expect(within(triage).getByText('Needs trust')).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Add to rail: Triage' })).not.toBeInTheDocument()
  })

  it('pins, unpins and shows surfaces', () => {
    const setPinned = vi.fn()
    useRightPanelRailStore.setState({ setPinned })
    render(<AllPanelsSurface />)
    fireEvent.click(screen.getByRole('button', { name: 'Add to rail: Session Tree' }))
    expect(setPinned).toHaveBeenCalledWith('session-tree', true)
    fireEvent.click(screen.getByRole('button', { name: 'Remove from rail: Changes' }))
    expect(setPinned).toHaveBeenCalledWith('changes', false)
    fireEvent.click(screen.getByRole('button', { name: /^Issues/ }))
    expect(mocks.showSurface).toHaveBeenCalledWith('extension:linear:issues')
  })

  it('offers extensions when none add a panel', () => {
    mocks.model = { surfaces: [entry('changes', { title: 'Changes' })] }
    render(<AllPanelsSurface />)
    fireEvent.click(screen.getByRole('button', { name: 'Browse extensions' }))
    expect(mocks.navigate).toHaveBeenCalledWith({
      to: '/settings/$tab',
      params: { tab: 'extensions' },
    })
  })
})
