import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useBrowserPreviewFloatingStore } from '@/features/browser-preview'
import {
  runtimeKeyOf,
  terminalInputDispatcher,
  terminalSidePanelLayoutKey,
  useTerminalStore,
} from '@/features/terminal'
import { useRightSidebarCoordinator } from '@/shared/lib/right-sidebar-coordinator'
import { archiveWorkspaceOwner, deleteWorkspaceOwner } from '../workspace-panel-cleanup'
import { useWorkspacePanelStore } from '../workspace-panel-store'

const apiMocks = vi.hoisted(() => ({
  closeBrowserPreview: vi.fn(async () => undefined),
  unregisterBrowserPreviewOwner: vi.fn(async () => undefined),
  writeTerminal: vi.fn(),
}))

vi.mock('@/shared/lib/ipc', () => ({ api: apiMocks }))

const OWNER = 'cleanup-session'

describe('workspace owner cleanup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    terminalInputDispatcher.clearOwner(OWNER)
    useBrowserPreviewFloatingStore.setState({ byOwnerKey: {} })
    useTerminalStore.setState({ groups: {}, activity: {}, portPreviews: {}, exits: {} })
    useWorkspacePanelStore.setState({ groups: {} })
    useRightSidebarCoordinator.setState({ activeClaim: null })
  })

  it('tombstones input, layouts, runtime metadata, and browser previews together', async () => {
    const terminalStore = useTerminalStore.getState()
    const baseTerminalId = terminalStore.createTerminal(OWNER, '/repo')
    const sideTerminalId = terminalStore.createTerminal(terminalSidePanelLayoutKey(OWNER), '/repo')
    if (baseTerminalId === null || sideTerminalId === null) {
      throw new Error('Expected terminal fixtures')
    }
    terminalStore.applyRuntimeEvent(OWNER, baseTerminalId, {
      type: 'activity',
      processName: 'node',
    })
    const input = terminalInputDispatcher.acquire(OWNER, baseTerminalId)
    input.enqueue('discard me')
    useWorkspacePanelStore.setState({
      groups: {
        [OWNER]: {
          browserTabs: [
            {
              id: 'preview-1',
              ownerKey: OWNER,
              kind: 'preview',
              profileId: 'default',
              url: 'https://example.com/',
              title: 'Example',
              loading: false,
              canGoBack: false,
              canGoForward: false,
              error: null,
              audioMuted: false,
              audible: false,
              favicon: null,
              controller: { kind: 'human' },
            },
          ],
          activeSurface: { kind: 'browser', previewId: 'preview-1' },
          maximized: false,
          panelOpen: true,
        },
      },
    })
    useBrowserPreviewFloatingStore.getState().open(OWNER, 'preview-1')

    await deleteWorkspaceOwner(OWNER)

    expect(input.snapshot().queuedChunks).toBe(0)
    expect(useTerminalStore.getState().groups[OWNER]).toBeUndefined()
    expect(useTerminalStore.getState().groups[terminalSidePanelLayoutKey(OWNER)]).toBeUndefined()
    expect(
      useTerminalStore.getState().activity[runtimeKeyOf(OWNER, baseTerminalId)],
    ).toBeUndefined()
    expect(useWorkspacePanelStore.getState().groups[OWNER]).toBeUndefined()
    expect(useBrowserPreviewFloatingStore.getState().byOwnerKey[OWNER]).toBeUndefined()
    expect(apiMocks.closeBrowserPreview).toHaveBeenCalledExactlyOnceWith('preview-1')
    expect(apiMocks.unregisterBrowserPreviewOwner).toHaveBeenCalledWith(OWNER)
    input.release()
  })

  it('retains terminal and panel layouts for restore without draining stale input', async () => {
    const terminalStore = useTerminalStore.getState()
    const sideOwner = terminalSidePanelLayoutKey(OWNER)
    const baseTerminalId = terminalStore.createTerminal(OWNER, '/repo')
    const sideTerminalId = terminalStore.createTerminal(sideOwner, '/repo')
    if (baseTerminalId === null || sideTerminalId === null) {
      throw new Error('Expected terminal fixtures')
    }
    terminalStore.applyRuntimeEvent(OWNER, baseTerminalId, {
      type: 'activity',
      processName: 'node',
    })
    terminalStore.applyRuntimeEvent(OWNER, sideTerminalId, {
      type: 'port-previews',
      previews: [{ host: 'localhost', port: 3000, url: 'http://localhost:3000/' }],
    })
    terminalStore.applyRuntimeEvent(OWNER, sideTerminalId, { type: 'exited', exitCode: 2 })
    const baseLayout = useTerminalStore.getState().groups[OWNER]
    const sideLayout = useTerminalStore.getState().groups[sideOwner]
    const staleInput = terminalInputDispatcher.acquire(OWNER, baseTerminalId)
    staleInput.enqueue('must not run after restore')
    useWorkspacePanelStore.setState({
      groups: {
        [OWNER]: {
          browserTabs: [
            {
              id: 'preview-restore',
              ownerKey: OWNER,
              kind: 'preview',
              profileId: 'default',
              url: 'https://example.com/restore',
              title: 'Restore',
              loading: false,
              canGoBack: false,
              canGoForward: false,
              error: null,
              audioMuted: false,
              audible: false,
              favicon: null,
              controller: { kind: 'human' },
            },
          ],
          activeSurface: { kind: 'browser', previewId: 'preview-restore' },
          maximized: false,
          panelOpen: true,
        },
      },
    })
    useRightSidebarCoordinator.getState().claimWorkspace(OWNER)
    useBrowserPreviewFloatingStore.getState().open(OWNER, 'preview-restore')

    await archiveWorkspaceOwner(OWNER)

    expect(useTerminalStore.getState().groups[OWNER]).toEqual(baseLayout)
    expect(useTerminalStore.getState().groups[sideOwner]).toEqual(sideLayout)
    expect(useTerminalStore.getState().activity).toEqual({})
    expect(useTerminalStore.getState().portPreviews).toEqual({})
    expect(useTerminalStore.getState().exits).toEqual({})
    expect(useWorkspacePanelStore.getState().groups[OWNER]?.browserTabs).toHaveLength(1)
    expect(useBrowserPreviewFloatingStore.getState().byOwnerKey[OWNER]).toBeUndefined()
    expect(useRightSidebarCoordinator.getState().activeClaim).toBeNull()
    expect(apiMocks.closeBrowserPreview).toHaveBeenCalledExactlyOnceWith('preview-restore')
    expect(apiMocks.unregisterBrowserPreviewOwner).toHaveBeenCalledWith(OWNER)

    staleInput.release()
    const restoredInput = terminalInputDispatcher.acquire(OWNER, baseTerminalId)
    restoredInput.markOpen({ phase: 'ready', generation: 2 })
    await Promise.resolve()
    expect(apiMocks.writeTerminal).not.toHaveBeenCalled()
    restoredInput.release()
  })
})
