import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { terminalSidePanelLayoutKey, useTerminalStore } from '@/features/terminal'
import { useRightSidebarCoordinator } from '@/shared/lib/right-sidebar-coordinator'
import { Button } from '@/shared/ui/Button'
import type { RightSidebarLayout } from '@/shared/ui/RightSidebarLayout'
import { useUIStore } from '../ui-store'
import { WorkspaceRightPanel } from '../WorkspaceRightPanel'
import type { WorkspaceSurfaceTabs } from '../WorkspaceSurfaceTabs'
import { useWorkspacePanelStore } from '../workspace-panel-store'

const mocks = vi.hoisted(() => ({
  context: { projectPath: '/repo' },
  closeBrowserPreview: vi.fn<(_id: string) => Promise<void>>(),
  showConfirm: vi.fn(async () => true),
}))
vi.mock('@/shared/lib/ipc', () => ({ api: mocks }))
vi.mock('@/features/chat/hooks', () => ({ useChat: () => ({ activeSession: null }) }))
vi.mock('@/features/sessions/hooks', () => ({ useProject: () => mocks.context }))
vi.mock('@/shared/hooks/useMediaQuery', () => ({ useMediaQuery: () => false }))
vi.mock('../useBrowserPreviewOwnerRegistration', () => ({
  useBrowserPreviewOwnerRegistration: vi.fn(),
}))
vi.mock('../WorkspacePanelContent', () => ({ WorkspacePanelContent: () => null }))
vi.mock('@/shared/ui/RightSidebarLayout', () => ({
  RightSidebarLayout: ({ sidebar, children }: ComponentProps<typeof RightSidebarLayout>) => (
    <>
      {sidebar}
      {children}
    </>
  ),
}))
vi.mock('../WorkspaceSurfaceTabs', () => ({
  WorkspaceSurfaceTabs: ({ model, actions }: ComponentProps<typeof WorkspaceSurfaceTabs>) => (
    <>
      {model.browserTabs.map((tab) => (
        <Button key={tab.id} onClick={() => actions.closeBrowsers([tab.id])}>
          Close {tab.id}
        </Button>
      ))}
      <Button onClick={() => actions.closeBrowsers(model.browserTabs.map((tab) => tab.id))}>
        Close all
      </Button>
    </>
  ),
}))

const OWNER = 'draft:/repo'
const closeBrowsersInStore = useWorkspacePanelStore.getState().closeBrowsers

describe('right-panel native browser close', () => {
  afterEach(() => vi.restoreAllMocks())
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.context.projectPath = '/repo'
    mocks.closeBrowserPreview.mockResolvedValue(undefined)
    useWorkspacePanelStore.setState({ groups: {}, closeBrowsers: closeBrowsersInStore })
    useTerminalStore.setState({ groups: {} })
    useRightSidebarCoordinator.setState({ activeClaim: null })
    useUIStore.setState({ toastMessage: null, toastData: null })
  })

  it('keeps a failed tab available and removes it only after the user retries successfully', async () => {
    const failure = new Error('Native view could not close')
    mocks.closeBrowserPreview.mockRejectedValueOnce(failure)
    const { previewId } = useWorkspacePanelStore
      .getState()
      .openBrowser(OWNER, 'https://example.test')
    render(<WorkspaceRightPanel>Chat</WorkspaceRightPanel>)
    const close = screen.getByRole('button', { name: `Close ${previewId}` })
    fireEvent.click(close)
    await waitFor(() => expect(useUIStore.getState().toastMessage).toBe(failure.message))
    expect(useWorkspacePanelStore.getState().groups[OWNER]?.browserTabs).toMatchObject([
      { id: previewId },
    ])
    expect(close).toBeInTheDocument()
    fireEvent.click(close)
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: `Close ${previewId}` })).not.toBeInTheDocument(),
    )
    expect(mocks.closeBrowserPreview).toHaveBeenCalledTimes(2)
  })

  it('preserves the native error when persisting successful sibling closure also fails', async () => {
    const { previewId: failed } = useWorkspacePanelStore
      .getState()
      .openBrowser(OWNER, 'https://example.test/failed')
    const { previewId: closed } = useWorkspacePanelStore
      .getState()
      .openBrowser(OWNER, 'https://example.test/closed')
    const nativeFailure = new Error('First native close failure')
    mocks.closeBrowserPreview.mockImplementation(async (id) => {
      if (id === failed) throw nativeFailure
    })
    const original = useWorkspacePanelStore.getState().closeBrowsers
    vi.spyOn(useWorkspacePanelStore.getState(), 'closeBrowsers').mockImplementation(
      (ownerKey, ids) => {
        original(ownerKey, ids)
        throw new Error('Later storage failure')
      },
    )
    render(<WorkspaceRightPanel>Chat</WorkspaceRightPanel>)
    fireEvent.click(screen.getByRole('button', { name: 'Close all' }))
    await waitFor(() =>
      expect(useWorkspacePanelStore.getState().groups[OWNER]?.browserTabs).toMatchObject([
        { id: failed },
      ]),
    )
    expect(screen.queryByRole('button', { name: `Close ${closed}` })).not.toBeInTheDocument()
    expect(useUIStore.getState().toastMessage).toBe(nativeFailure.message)
  })

  it('reveals the retained terminal after the current panel closes its last browser', async () => {
    const { previewId } = useWorkspacePanelStore
      .getState()
      .openBrowser(OWNER, 'https://example.test')
    const sideKey = terminalSidePanelLayoutKey(OWNER)
    useTerminalStore.getState().createTerminal(sideKey, '/repo')
    useTerminalStore.getState().setPanelOpen(sideKey, true)
    render(<WorkspaceRightPanel>Chat</WorkspaceRightPanel>)
    fireEvent.click(screen.getByRole('button', { name: `Close ${previewId}` }))
    await waitFor(() =>
      expect(useWorkspacePanelStore.getState().groups[OWNER]?.activeSurface).toEqual({
        kind: 'terminal',
      }),
    )
    expect(useRightSidebarCoordinator.getState().activeClaim).toEqual({
      kind: 'workspace',
      ownerKey: OWNER,
    })
  })

  it('still reveals the current terminal when persisting the closed browser list fails', async () => {
    const { previewId } = useWorkspacePanelStore
      .getState()
      .openBrowser(OWNER, 'https://example.test')
    const sideKey = terminalSidePanelLayoutKey(OWNER)
    useTerminalStore.getState().createTerminal(sideKey, '/repo')
    useTerminalStore.getState().setPanelOpen(sideKey, true)
    vi.spyOn(useWorkspacePanelStore.getState(), 'closeBrowsers').mockImplementation(
      (ownerKey, ids) => {
        closeBrowsersInStore(ownerKey, ids)
        throw new Error('Browser layout storage failed')
      },
    )
    render(<WorkspaceRightPanel>Chat</WorkspaceRightPanel>)
    fireEvent.click(screen.getByRole('button', { name: `Close ${previewId}` }))
    await waitFor(() =>
      expect(useWorkspacePanelStore.getState().groups[OWNER]?.activeSurface).toEqual({
        kind: 'terminal',
      }),
    )
    expect(useUIStore.getState().toastMessage).toBe('Browser layout storage failed')
    expect(useRightSidebarCoordinator.getState().activeClaim).toEqual({
      kind: 'workspace',
      ownerKey: OWNER,
    })
  })

  it('does not claim another session inspector when native closure completes after navigation', async () => {
    const pending = Promise.withResolvers<void>()
    mocks.closeBrowserPreview.mockReturnValueOnce(pending.promise)
    const { previewId } = useWorkspacePanelStore
      .getState()
      .openBrowser(OWNER, 'https://example.test')
    const sideKey = terminalSidePanelLayoutKey(OWNER)
    useTerminalStore.getState().createTerminal(sideKey, '/repo')
    useTerminalStore.getState().setPanelOpen(sideKey, true)
    const view = render(<WorkspaceRightPanel>Chat</WorkspaceRightPanel>)
    fireEvent.click(screen.getByRole('button', { name: `Close ${previewId}` }))
    await waitFor(() => expect(mocks.closeBrowserPreview).toHaveBeenCalledWith(previewId))
    mocks.context.projectPath = '/other'
    view.rerender(<WorkspaceRightPanel>Other chat</WorkspaceRightPanel>)
    act(() => useRightSidebarCoordinator.getState().claimRoute('diff', 'draft:/other'))
    await act(async () => {
      pending.resolve()
      await pending.promise
    })
    await waitFor(() =>
      expect(useWorkspacePanelStore.getState().groups[OWNER]?.browserTabs).toHaveLength(0),
    )
    expect(useRightSidebarCoordinator.getState().activeClaim).toEqual({
      kind: 'route',
      requestKey: 'diff',
      scopeKey: 'draft:/other',
    })
  })
})
