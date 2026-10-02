import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { GitCompare, Globe2, LayoutGrid, Play } from 'lucide-react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RightPanelSurfaceId } from '@/shared/lib/right-panel-surfaces'
import { PanelRail } from '../PanelRail'
import type { RightPanelModel, RightPanelSurfaceEntry } from '../useRightPanelModel'

function entry(
  id: RightPanelSurfaceId,
  icon: typeof LayoutGrid,
  overrides: Partial<RightPanelSurfaceEntry> = {},
): RightPanelSurfaceEntry {
  return {
    id,
    title: id,
    description: id,
    glyph: { kind: 'lucide', icon },
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

function model(overrides: Partial<RightPanelModel> = {}): RightPanelModel {
  const allPanels = entry('all-panels', LayoutGrid, { title: 'All panels', group: null })
  const changes = entry('changes', GitCompare, { title: 'Changes', shortcutLabel: '⌘D' })
  const actions = entry('project-actions', Play, { title: 'Project Actions', running: true })
  const browser = entry('browser', Globe2, {
    title: 'Browser',
    disabledReason: 'Open a project first',
  })
  return {
    ownerKey: 'session-1',
    sessionKey: 'session-1',
    projectPath: '/repo',
    shown: { open: true, shown: 'changes', highlight: 'changes', kind: 'route' },
    surfaces: [allPanels, changes, actions, browser],
    railSurfaces: [changes, actions, browser],
    knownRailIds: ['changes', 'project-actions', 'browser'],
    extensionPanels: [],
    extensionRegistryLoaded: true,
    ...overrides,
  }
}

function renderRail(input: Partial<RightPanelModel> = {}) {
  const actions = {
    toggleSurface: vi.fn(),
    showSurface: vi.fn(),
    move: vi.fn(),
    unpin: vi.fn(),
    reset: vi.fn(),
  }
  render(<PanelRail model={model(input)} actions={actions} />)
  return actions
}

describe('PanelRail', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('lists All panels first, marks the shown surface and names shortcuts and reasons', () => {
    renderRail()
    const rail = screen.getByRole('navigation', { name: 'Panels' })
    const buttons = within(rail).getAllByRole('button')
    expect(buttons.map((button) => button.getAttribute('data-rail-surface'))).toEqual([
      'all-panels',
      'changes',
      'project-actions',
      'browser',
    ])
    expect(within(rail).getByRole('button', { name: 'Changes (⌘D)' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(within(rail).getByRole('button', { name: 'Project Actions · running' })).toBeVisible()
    expect(
      within(rail).getByRole('button', { name: 'Browser — Open a project first' }),
    ).toHaveAttribute('aria-disabled', 'true')
  })

  it('toggles a surface on click and reorders with Alt+Arrow keys', () => {
    const actions = renderRail()
    fireEvent.click(screen.getByRole('button', { name: 'Changes (⌘D)' }))
    expect(actions.toggleSurface).toHaveBeenCalledWith('changes')

    fireEvent.keyDown(screen.getByRole('button', { name: 'Project Actions · running' }), {
      key: 'ArrowUp',
      altKey: true,
    })
    expect(actions.move).toHaveBeenCalledWith('project-actions', { type: 'up' })
  })

  it('picks an icon up only after a press and hold, and the drop does not open it', () => {
    const actions = renderRail()
    const actionsButton = screen.getByRole('button', { name: 'Project Actions · running' })
    const changesButton = screen.getByRole('button', { name: 'Changes (⌘D)' })
    vi.spyOn(changesButton, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 40, 32, 32))
    vi.spyOn(actionsButton, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 74, 32, 32))
    actionsButton.setPointerCapture = vi.fn()

    fireEvent.pointerDown(actionsButton, { button: 0, clientY: 90, pointerId: 1 })
    act(() => vi.advanceTimersByTime(400))
    fireEvent.pointerMove(actionsButton, { clientY: 45, pointerId: 1 })
    fireEvent.pointerUp(actionsButton, { clientY: 45, pointerId: 1 })
    fireEvent.click(actionsButton)

    expect(actions.move).toHaveBeenCalledWith('project-actions', {
      type: 'before',
      target: 'changes',
    })
    expect(actions.toggleSurface).not.toHaveBeenCalled()
  })

  it('treats a short press as a click', () => {
    const actions = renderRail()
    const button = screen.getByRole('button', { name: 'Changes (⌘D)' })
    fireEvent.pointerDown(button, { button: 0, clientY: 50, pointerId: 1 })
    act(() => vi.advanceTimersByTime(100))
    fireEvent.pointerUp(button, { clientY: 50, pointerId: 1 })
    fireEvent.click(button)
    expect(actions.move).not.toHaveBeenCalled()
    expect(actions.toggleSurface).toHaveBeenCalledWith('changes')
  })

  it('offers reorder, unpin, All panels and reset from the right-click menu', () => {
    const actions = renderRail()
    fireEvent.contextMenu(screen.getByRole('button', { name: 'Changes (⌘D)' }), {
      clientX: 10,
      clientY: 10,
    })
    const menu = screen.getByRole('menu', { name: 'Changes options' })
    expect(within(menu).getByRole('menuitem', { name: /^Move up/ })).toBeDisabled()
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Remove from rail' }))
    expect(actions.unpin).toHaveBeenCalledWith('changes')

    fireEvent.contextMenu(screen.getByRole('button', { name: 'Changes (⌘D)' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'All panels' }))
    expect(actions.showSurface).toHaveBeenCalledWith('all-panels')
    fireEvent.contextMenu(screen.getByRole('button', { name: 'Changes (⌘D)' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Reset rail' }))
    expect(actions.reset).toHaveBeenCalledOnce()
    expect(
      screen.queryByRole('menuitemcheckbox', { name: 'Keep rail visible when panel is closed' }),
    ).not.toBeInTheDocument()
  })
})
