import { act, fireEvent, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useRightSidebarCoordinator } from '@/shared/lib/right-sidebar-coordinator'
import { renderChatRoute, routeSurfaceMocks } from './route-surfaces.test-harness'

describe('route surfaces', () => {
  beforeEach(() => {
    routeSurfaceMocks.setWorkingPath('/repo')
    routeSurfaceMocks.setLastPanel('diff')
    useRightSidebarCoordinator.setState({ activeClaim: null })
    routeSurfaceMocks.setLastRightSidebarPanel.mockClear()
    routeSurfaceMocks.chatRouteEffects.mockClear()
    routeSurfaceMocks.sidePanelRefetch.mockClear()
  })

  it('keeps a no-project root extension inspector available without claiming a workspace owner', async () => {
    routeSurfaceMocks.setWorkingPath(null)
    renderChatRoute({
      workspace: { sessionId: null, branchId: null, nodeId: null },
      rightSidebar: {
        extensionSidePanel: { extensionId: 'global-extension', sidePanelId: 'global.panel' },
      },
    })
    expect(useRightSidebarCoordinator.getState().activeClaim).toMatchObject({
      kind: 'route',
      scopeKey: null,
    })
    expect(
      await screen.findByText('Extension side panel global-extension/global.panel'),
    ).toBeInTheDocument()
    act(() => useRightSidebarCoordinator.getState().claimWorkspace('draft:/other-repo'))
    expect(screen.getByRole('main')).toHaveAttribute('data-summary-suppressed', 'false')
    expect(screen.getByTestId('route-right-sidebar-layout')).toHaveAttribute('data-open', 'false')
  })

  it.each([
    { sessionId: 'session-1', ownerKey: 'session-1' },
    { sessionId: null, ownerKey: 'draft:/repo' },
  ])('claims the inspector using workspace owner $ownerKey', ({ sessionId, ownerKey }) => {
    renderChatRoute({
      workspace: { sessionId, branchId: null, nodeId: null },
      rightSidebar: { diffOpen: true },
    })
    expect(useRightSidebarCoordinator.getState().activeClaim).toEqual({
      kind: 'route',
      requestKey: 'diff',
      scopeKey: ownerKey,
    })
  })

  it('suppresses Summary for only the current Session workspace inspector and restores it after hiding', () => {
    renderChatRoute({ rightSidebar: {} })
    const chat = screen.getByRole('main')
    act(() => useRightSidebarCoordinator.getState().claimWorkspace('another-session'))
    expect(chat).toHaveAttribute('data-summary-suppressed', 'false')
    act(() => useRightSidebarCoordinator.getState().claimWorkspace('session-1'))
    expect(chat).toHaveAttribute('data-summary-suppressed', 'true')
    act(() => useRightSidebarCoordinator.getState().releaseWorkspace('session-1'))
    expect(chat).toHaveAttribute('data-summary-suppressed', 'false')
  })

  it('does not keep Summary suppressed by stale hidden route state after a workspace panel closes', () => {
    renderChatRoute({ rightSidebar: { resourcesTarget: { view: 'sources' } } })
    const chat = screen.getByRole('main')
    expect(chat).toHaveAttribute('data-summary-suppressed', 'true')
    act(() => useRightSidebarCoordinator.getState().claimWorkspace('session-1'))
    expect(screen.getByTestId('route-right-sidebar-layout')).toHaveAttribute('data-open', 'false')
    act(() => useRightSidebarCoordinator.getState().releaseWorkspace('session-1'))
    expect(chat).toHaveAttribute('data-summary-suppressed', 'false')
  })

  it('renders chat content with the active diff sidebar and closes it through route state', async () => {
    const onDiffOpenChange = vi.fn()
    const onSessionTreeOpenChange = vi.fn()

    renderChatRoute({
      workspace: { branchId: 'branch-1', nodeId: 'node-1', sessionId: 'session-1' },
      rightSidebar: { diffOpen: true },
      actions: { onDiffOpenChange, onSessionTreeOpenChange },
    })

    expect(screen.getByText('Chat content')).toBeInTheDocument()
    expect(document.querySelector('[data-chat-route-session-id]')).toHaveAttribute(
      'data-chat-route-session-id',
      'session-1',
    )
    expect(await screen.findByText('Diff pane')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Close right sidebar' }))

    expect(routeSurfaceMocks.chatRouteEffects).toHaveBeenCalledWith({
      branchId: 'branch-1',
      diffOpen: true,
      nodeId: 'node-1',
      sessionId: 'session-1',
    })
    expect(routeSurfaceMocks.setLastRightSidebarPanel).toHaveBeenCalledWith('diff')
    expect(onDiffOpenChange).toHaveBeenCalledWith(false)
    expect(onSessionTreeOpenChange).not.toHaveBeenCalled()
  })

  it('routes a bound change request to the in-app sidebar and clears it on close', () => {
    const onChangeRequestOpenChange = vi.fn()
    renderChatRoute({
      rightSidebar: { changeRequestUrl: 'https://github.com/o/r/pull/7' },
      actions: { onChangeRequestOpenChange },
    })

    expect(
      screen.getByText('Change request panel: https://github.com/o/r/pull/7'),
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Close change request' }))
    expect(routeSurfaceMocks.setLastRightSidebarPanel).toHaveBeenCalledWith('change-request')
    expect(onChangeRequestOpenChange).toHaveBeenCalledWith(false, undefined)
  })

  it('renders Session Tree when that panel is open and routes close events to the tree toggle', async () => {
    const onDiffOpenChange = vi.fn()
    const onSessionTreeOpenChange = vi.fn()

    renderChatRoute({
      rightSidebar: { sessionTreeOpen: true },
      actions: { onDiffOpenChange, onSessionTreeOpenChange },
    })

    expect(await screen.findByText('Session Tree panel')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Close right sidebar' }))

    expect(routeSurfaceMocks.setLastRightSidebarPanel).toHaveBeenCalledWith('session-tree')
    expect(onSessionTreeOpenChange).toHaveBeenCalledWith(false)
    expect(onDiffOpenChange).not.toHaveBeenCalled()
  })

  it('renders extension side panels from route state and routes close events to extension search', async () => {
    const onDiffOpenChange = vi.fn()
    const onSessionTreeOpenChange = vi.fn()
    const onExtensionSidePanelOpenChange = vi.fn()

    renderChatRoute({
      rightSidebar: {
        extensionSidePanel: {
          extensionId: 'sample-extension',
          sidePanelId: 'sample.side-panel',
        },
      },
      actions: { onDiffOpenChange, onExtensionSidePanelOpenChange, onSessionTreeOpenChange },
    })

    expect(
      await screen.findByText('Extension side panel sample-extension/sample.side-panel'),
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Close right sidebar' }))

    expect(routeSurfaceMocks.setLastRightSidebarPanel).toHaveBeenCalledWith({
      kind: 'extension-side-panel',
      extensionId: 'sample-extension',
      sidePanelId: 'sample.side-panel',
    })
    expect(onExtensionSidePanelOpenChange).toHaveBeenCalledWith(false, {
      extensionId: 'sample-extension',
      sidePanelId: 'sample.side-panel',
    })
    expect(onDiffOpenChange).not.toHaveBeenCalled()
    expect(onSessionTreeOpenChange).not.toHaveBeenCalled()
  })

  it('binds the resource sidebar to its explicit view and resource target', () => {
    const onResourcesTargetChange = vi.fn()

    renderChatRoute({
      rightSidebar: { resourcesTarget: { view: 'outputs', resourceId: 'created-pr' } },
      actions: { onResourcesTargetChange },
    })

    expect(screen.getByText('Session resources panel: outputs/created-pr')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Show sources' }))
    expect(onResourcesTargetChange).toHaveBeenCalledWith({ view: 'sources' })

    fireEvent.click(screen.getByRole('button', { name: 'Close resources' }))
    expect(onResourcesTargetChange).toHaveBeenCalledWith(null)
  })
})
