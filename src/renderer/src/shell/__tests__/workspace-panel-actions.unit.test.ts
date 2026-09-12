import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useBrowserPreviewFloatingStore } from '@/features/browser-preview'
import { useRightSidebarCoordinator } from '@/shared/lib/right-sidebar-coordinator'
import {
  closeWorkspaceRightPanel,
  hasActiveWorkspaceRightPanel,
  openWorkspacePreviewWithResult,
  refreshWorkspacePreview,
  toggleWorkspacePanelMaximized,
  toggleWorkspacePreview,
  toggleWorkspaceRightPanel,
  zoomWorkspacePreview,
} from '../workspace-panel-actions'
import { useWorkspacePanelStore } from '../workspace-panel-store'

const apiMocks = vi.hoisted(() => ({
  closeBrowserPreview: vi.fn().mockResolvedValue(undefined),
  reloadBrowserPreview: vi.fn().mockResolvedValue(undefined),
  zoomBrowserPreview: vi.fn().mockResolvedValue(1.1),
}))

vi.mock('@/shared/lib/ipc', () => ({ api: apiMocks }))

const OWNER = 'session-1'

describe('workspace panel shortcut actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useBrowserPreviewFloatingStore.setState({ byOwnerKey: {} })
    useRightSidebarCoordinator.setState({ activeClaim: null })
    useWorkspacePanelStore.setState({ groups: {} })
  })

  it('toggles, maximizes, and closes an existing retained right-panel surface', () => {
    expect(hasActiveWorkspaceRightPanel(OWNER)).toBe(false)
    useWorkspacePanelStore.getState().showTerminal(OWNER)

    expect(hasActiveWorkspaceRightPanel(OWNER)).toBe(true)
    expect(toggleWorkspacePanelMaximized(OWNER)).toBe(true)
    expect(useWorkspacePanelStore.getState().groups[OWNER]?.maximized).toBe(true)
    expect(toggleWorkspaceRightPanel(OWNER)).toBe(true)
    expect(useWorkspacePanelStore.getState().groups[OWNER]?.panelOpen).toBe(false)
    expect(toggleWorkspaceRightPanel(OWNER)).toBe(true)
    expect(useWorkspacePanelStore.getState().groups[OWNER]?.panelOpen).toBe(true)
    closeWorkspaceRightPanel(OWNER)
    expect(hasActiveWorkspaceRightPanel(OWNER)).toBe(false)
    expect(useWorkspacePanelStore.getState().groups[OWNER]?.panelOpen).toBe(false)
  })

  it('selects the latest preview and routes refresh and zoom through typed IPC', async () => {
    const preview = useWorkspacePanelStore.getState().openBrowser(OWNER, 'https://example.com/docs')
    useWorkspacePanelStore.getState().showTerminal(OWNER)

    expect(toggleWorkspacePreview(OWNER)).toBe(true)
    expect(useWorkspacePanelStore.getState().groups[OWNER]?.activeSurface).toEqual({
      kind: 'browser',
      previewId: preview.previewId,
    })
    await expect(refreshWorkspacePreview(OWNER)).resolves.toBe(true)
    await expect(zoomWorkspacePreview(OWNER, 'in')).resolves.toBe(true)
    expect(apiMocks.reloadBrowserPreview).toHaveBeenCalledWith(preview.previewId)
    expect(apiMocks.zoomBrowserPreview).toHaveBeenCalledWith(preview.previewId, 'in')
  })

  it('creates an empty browser launcher from the preview shortcut when none exists', async () => {
    expect(toggleWorkspaceRightPanel(OWNER)).toBe(false)
    expect(toggleWorkspacePanelMaximized(OWNER)).toBe(false)
    expect(toggleWorkspacePreview(OWNER)).toBe(true)
    expect(useWorkspacePanelStore.getState().groups[OWNER]).toMatchObject({
      activeSurface: { kind: 'browser' },
      browserTabs: [{ kind: 'launcher', url: '', controller: { kind: 'human' } }],
      panelOpen: true,
    })
    await expect(refreshWorkspacePreview(OWNER)).resolves.toBe(false)
    await expect(zoomWorkspacePreview(OWNER, 'reset')).resolves.toBe(false)
  })

  it('destroys an evicted native preview and its floating placement together', () => {
    const first = openWorkspacePreviewWithResult(OWNER, 'https://example.com/0')
    useBrowserPreviewFloatingStore.getState().open(OWNER, first.previewId)
    for (let index = 1; index < 8; index += 1) {
      openWorkspacePreviewWithResult(OWNER, `https://example.com/${String(index)}`)
    }

    const ninth = openWorkspacePreviewWithResult(OWNER, 'https://example.com/8')

    expect(ninth.evictedPreviewId).toBe(first.previewId)
    expect(apiMocks.closeBrowserPreview).toHaveBeenCalledExactlyOnceWith(first.previewId)
    expect(useBrowserPreviewFloatingStore.getState().byOwnerKey[OWNER]).toBeUndefined()
  })
})
