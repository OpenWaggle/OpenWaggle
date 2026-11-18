import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { usePreferencesStore } from '@/features/settings/state'
import { terminalSidePanelLayoutKey, useTerminalStore } from '@/features/terminal'
import { useRightSidebarCoordinator } from '@/shared/lib/right-sidebar-coordinator'
import { useUIStore } from '../ui-store'
import { WorkspaceRightPanel } from '../WorkspaceRightPanel'
import { useWorkspacePanelStore } from '../workspace-panel-store'
import { DRAFT_OWNER, resetWorkspaceShellStores } from './workspace-shell.test-harness'

const mocks = vi.hoisted(() => ({
  closeBrowserPreview: vi.fn<(_id: string) => Promise<void>>(),
}))
vi.mock('@/shared/lib/ipc', async () => ({
  api: (await import('@/test-utils/preload-api')).preloadApi({
    closeBrowserPreview: mocks.closeBrowserPreview,
    registerBrowserPreviewOwner: async () => undefined,
    unregisterBrowserPreviewOwner: async () => undefined,
    setCurrentBrowserPreview: async () => undefined,
  }),
}))
// The native browser view, lazily loaded; jsdom has no native view and its own tests cover it.
vi.mock('@/features/browser-preview/components', () => ({ BrowserPreviewPanel: () => null }))

const toastMessage = () => useUIStore.getState().toastMessage
const ownerGroup = () => useWorkspacePanelStore.getState().groups[DRAFT_OWNER]

function openBrowser(host: string) {
  return useWorkspacePanelStore.getState().openBrowser(DRAFT_OWNER, `https://${host}`).previewId
}

function openSideTerminal() {
  const sideKey = terminalSidePanelLayoutKey(DRAFT_OWNER)
  useTerminalStore.getState().createTerminal(sideKey, '/repo')
  useTerminalStore.getState().setPanelOpen(sideKey, true)
}

/** Fails the next write of the browser layout, as a full or unavailable storage does. */
function failNextPanelWrite(message: string) {
  const storage = useWorkspacePanelStore.persist.getOptions().storage
  if (!storage) throw new Error('Expected workspace panel persistence storage')
  const write = storage.setItem.bind(storage)
  let failed = false
  vi.spyOn(storage, 'setItem').mockImplementation((...args) => {
    if (failed) return write(...args)
    failed = true
    throw new Error(message)
  })
}

function openProject(projectPath: string) {
  const { settings } = usePreferencesStore.getState()
  usePreferencesStore.setState({ settings: { ...settings, projectPath } })
}

function renderPanel(children = 'Chat') {
  return render(<WorkspaceRightPanel>{children}</WorkspaceRightPanel>)
}

describe('right-panel native browser close', () => {
  beforeEach(() => {
    resetWorkspaceShellStores()
    mocks.closeBrowserPreview.mockReset().mockResolvedValue(undefined)
  })
  afterEach(() => {
    vi.restoreAllMocks()
    resetWorkspaceShellStores()
  })

  it('keeps a failed tab available and removes it only after the user retries successfully', async () => {
    const failure = new Error('Native view could not close')
    mocks.closeBrowserPreview.mockRejectedValueOnce(failure)
    openBrowser('example.test')
    renderPanel()
    const close = screen.getByRole('button', { name: 'Close example.test' })
    fireEvent.click(close)
    await waitFor(() => expect(toastMessage()).toBe(failure.message))
    expect(close).toBeInTheDocument()
    expect(ownerGroup()?.browserTabs).toHaveLength(1)
    fireEvent.click(close)
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Close example.test' })).not.toBeInTheDocument(),
    )
    expect(ownerGroup()?.browserTabs).toHaveLength(0)
  })

  it('preserves the native error when persisting successful sibling closure also fails', async () => {
    const failed = openBrowser('failed.test')
    openBrowser('closed.test')
    const nativeFailure = new Error('First native close failure')
    mocks.closeBrowserPreview.mockImplementation(async (id) => {
      if (id === failed) throw nativeFailure
    })
    renderPanel()
    fireEvent.contextMenu(screen.getByRole('tab', { name: 'closed.test' }))
    failNextPanelWrite('Later storage failure')
    fireEvent.click(screen.getByRole('menuitem', { name: 'Close all' }))
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Close closed.test' })).not.toBeInTheDocument(),
    )
    expect(screen.getByRole('button', { name: 'Close failed.test' })).toBeInTheDocument()
    expect(ownerGroup()?.browserTabs).toMatchObject([{ id: failed }])
    expect(toastMessage()).toBe(nativeFailure.message)
  })

  it.each([
    ['', null],
    [' when persisting the closed browser list fails', 'Browser layout storage failed'],
  ])(
    'reveals the retained terminal after the current panel closes its last browser%s',
    async (_case, storageFailure) => {
      openBrowser('example.test')
      openSideTerminal()
      renderPanel()
      if (storageFailure !== null) failNextPanelWrite(storageFailure)
      fireEvent.click(screen.getByRole('button', { name: 'Close example.test' }))
      expect(await screen.findByRole('heading', { name: 'Terminal' })).toBeInTheDocument()
      expect(ownerGroup()?.activeSurface).toEqual({ kind: 'terminal' })
      expect(toastMessage()).toBe(storageFailure)
      expect(useRightSidebarCoordinator.getState().activeClaim).toEqual({
        kind: 'workspace',
        ownerKey: DRAFT_OWNER,
      })
    },
  )

  it('does not claim another session inspector when native closure completes after navigation', async () => {
    const pending = Promise.withResolvers<void>()
    mocks.closeBrowserPreview.mockReturnValueOnce(pending.promise)
    openBrowser('example.test')
    openSideTerminal()
    const view = renderPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Close example.test' }))
    await waitFor(() => expect(mocks.closeBrowserPreview).toHaveBeenCalled())
    act(() => openProject('/other'))
    view.rerender(<WorkspaceRightPanel>Other chat</WorkspaceRightPanel>)
    act(() => useRightSidebarCoordinator.getState().claimRoute('diff', 'draft:/other'))
    await act(async () => {
      pending.resolve()
      await pending.promise
    })
    await waitFor(() => expect(ownerGroup()?.browserTabs).toHaveLength(0))
    expect(useRightSidebarCoordinator.getState().activeClaim).toEqual({
      kind: 'route',
      requestKey: 'diff',
      scopeKey: 'draft:/other',
    })
    expect(ownerGroup()).toMatchObject({ activeSurface: { kind: 'terminal' }, panelOpen: true })
    act(() => useRightSidebarCoordinator.getState().releaseRoute('diff', 'draft:/other'))
    act(() => openProject('/repo'))
    view.rerender(<WorkspaceRightPanel>Chat again</WorkspaceRightPanel>)
    expect(await screen.findByRole('heading', { name: 'Terminal' })).toBeInTheDocument()
    expect(useRightSidebarCoordinator.getState().activeClaim).toEqual({
      kind: 'workspace',
      ownerKey: DRAFT_OWNER,
    })
  })

  it('does not reopen a panel explicitly hidden while native closure is pending', async () => {
    const pending = Promise.withResolvers<void>()
    mocks.closeBrowserPreview.mockReturnValueOnce(pending.promise)
    openBrowser('example.test')
    openSideTerminal()
    renderPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Close example.test' }))
    await waitFor(() => expect(mocks.closeBrowserPreview).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: 'Close side panel' }))
    await act(async () => {
      pending.resolve()
      await pending.promise
    })
    await waitFor(() => expect(ownerGroup()?.browserTabs).toHaveLength(0))
    expect(ownerGroup()?.panelOpen).toBe(false)
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
    expect(useRightSidebarCoordinator.getState().activeClaim).toBeNull()
  })
})
