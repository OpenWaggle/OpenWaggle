import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useBrowserPreviewFloatingStore } from '@/features/browser-preview'
import { useRightSidebarCoordinator } from '@/shared/lib/right-sidebar-coordinator'
import { useWorkspacePanelStore } from '../workspace-panel-store'

const OWNER = 'session-1'

describe('workspace panel store', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    useBrowserPreviewFloatingStore.setState({ byOwnerKey: {} })
    useRightSidebarCoordinator.setState({ activeClaim: null })
    useWorkspacePanelStore.setState({ groups: {} })
  })

  it('deduplicates exact URL tabs opened from links', () => {
    const first = useWorkspacePanelStore.getState().openBrowser(OWNER, 'https://example.com/')
    useWorkspacePanelStore.getState().showTerminal(OWNER)
    const second = useWorkspacePanelStore.getState().openBrowser(OWNER, 'https://example.com/')

    expect(second).toEqual({ previewId: first.previewId, evictedPreviewId: null })
    expect(useWorkspacePanelStore.getState().groups[OWNER]?.browserTabs).toHaveLength(1)
    expect(useWorkspacePanelStore.getState().groups[OWNER]?.activeSurface).toEqual({
      kind: 'browser',
      previewId: first.previewId,
    })
  })

  it('creates independent launchers and materializes identical destinations independently', () => {
    const first = useWorkspacePanelStore.getState().newBrowser(OWNER, 'default')
    const second = useWorkspacePanelStore.getState().newBrowser(OWNER, 'default')

    expect(first.previewId).not.toBe(second.previewId)
    expect(useWorkspacePanelStore.getState().groups[OWNER]?.browserTabs).toMatchObject([
      { id: first.previewId, kind: 'launcher', url: '' },
      { id: second.previewId, kind: 'launcher', url: '' },
    ])

    useWorkspacePanelStore
      .getState()
      .materializeBrowser(OWNER, first.previewId, 'https://example.com/', 'default')
    useWorkspacePanelStore
      .getState()
      .materializeBrowser(OWNER, second.previewId, 'https://example.com/', 'default')

    expect(useWorkspacePanelStore.getState().groups[OWNER]?.browserTabs).toMatchObject([
      { id: first.previewId, kind: 'preview', url: 'https://example.com/' },
      { id: second.previewId, kind: 'preview', url: 'https://example.com/' },
    ])
  })

  it('caps retained browser tabs and reports the native view that must be destroyed', () => {
    const ids: string[] = []
    for (let index = 0; index < 8; index += 1) {
      ids.push(
        useWorkspacePanelStore.getState().openBrowser(OWNER, `https://example.com/${String(index)}`)
          .previewId,
      )
    }

    const ninth = useWorkspacePanelStore.getState().openBrowser(OWNER, 'https://example.com/eight')

    expect(ninth.evictedPreviewId).toBe(ids[0])
    expect(useWorkspacePanelStore.getState().groups[OWNER]?.browserTabs).toHaveLength(8)
  })

  it('falls back to another browser surface when the active tab closes', () => {
    const first = useWorkspacePanelStore.getState().openBrowser(OWNER, 'https://example.com/one')
    const second = useWorkspacePanelStore.getState().openBrowser(OWNER, 'https://example.com/two')
    useBrowserPreviewFloatingStore.getState().open(OWNER, second.previewId)

    useWorkspacePanelStore.getState().closeBrowser(OWNER, second.previewId)

    expect(useWorkspacePanelStore.getState().groups[OWNER]?.activeSurface).toEqual({
      kind: 'browser',
      previewId: first.previewId,
    })
    expect(useBrowserPreviewFloatingStore.getState().byOwnerKey[OWNER]).toBeUndefined()
  })

  it('cleans a stale floating placement even after its panel group is gone', () => {
    useBrowserPreviewFloatingStore.getState().open(OWNER, 'stale-preview')

    useWorkspacePanelStore.getState().closeBrowser(OWNER, 'stale-preview')

    expect(useBrowserPreviewFloatingStore.getState().byOwnerKey[OWNER]).toBeUndefined()
  })

  it('closes a selected set atomically and activates the last retained browser', () => {
    const first = useWorkspacePanelStore.getState().newBrowser(OWNER)
    const second = useWorkspacePanelStore.getState().newBrowser(OWNER)
    const third = useWorkspacePanelStore.getState().newBrowser(OWNER)

    useWorkspacePanelStore.getState().closeBrowsers(OWNER, [first.previewId, third.previewId])

    expect(useWorkspacePanelStore.getState().groups[OWNER]).toMatchObject({
      activeSurface: { kind: 'browser', previewId: second.previewId },
      browserTabs: [{ id: second.previewId }],
      panelOpen: true,
    })
  })

  it('hides the panel without destroying its retained surfaces', () => {
    const browser = useWorkspacePanelStore.getState().openBrowser(OWNER, 'https://example.com/one')
    useWorkspacePanelStore.getState().showTerminal(OWNER)

    useWorkspacePanelStore.getState().hidePanel(OWNER)

    expect(useWorkspacePanelStore.getState().groups[OWNER]).toMatchObject({
      activeSurface: { kind: 'terminal' },
      browserTabs: [{ id: browser.previewId }],
      panelOpen: false,
    })
    expect(useRightSidebarCoordinator.getState().activeClaim).toBeNull()
    useWorkspacePanelStore.getState().showBrowser(OWNER, browser.previewId)
    expect(useWorkspacePanelStore.getState().groups[OWNER]?.panelOpen).toBe(true)
    expect(useRightSidebarCoordinator.getState().activeClaim).toEqual({
      kind: 'workspace',
      ownerKey: OWNER,
    })
  })

  it('retains maximized state independently from panel visibility and surface data', () => {
    const browser = useWorkspacePanelStore.getState().openBrowser(OWNER, 'https://example.com/one')

    useWorkspacePanelStore.getState().setMaximized(OWNER, true)
    useWorkspacePanelStore.getState().hidePanel(OWNER)

    expect(useWorkspacePanelStore.getState().groups[OWNER]).toMatchObject({
      activeSurface: { kind: 'browser', previewId: browser.previewId },
      maximized: true,
      panelOpen: false,
    })
    useWorkspacePanelStore.getState().showBrowser(OWNER, browser.previewId)
    expect(useWorkspacePanelStore.getState().groups[OWNER]?.maximized).toBe(true)
  })

  it('migrates draft previews to the born Session without changing preview ids', () => {
    const preview = useWorkspacePanelStore
      .getState()
      .openBrowser('draft:/repo', 'http://localhost:5173/')
    useBrowserPreviewFloatingStore.getState().open('draft:/repo', preview.previewId)

    useWorkspacePanelStore.getState().migrateGroup('draft:/repo', OWNER)

    expect(useWorkspacePanelStore.getState().groups['draft:/repo']).toBeUndefined()
    expect(useWorkspacePanelStore.getState().groups[OWNER]?.browserTabs[0]?.id).toBe(
      preview.previewId,
    )
    expect(useBrowserPreviewFloatingStore.getState().byOwnerKey['draft:/repo']).toBeUndefined()
    expect(useBrowserPreviewFloatingStore.getState().byOwnerKey[OWNER]).toMatchObject({
      previewId: preview.previewId,
    })
    expect(useRightSidebarCoordinator.getState().activeClaim).toEqual({
      kind: 'workspace',
      ownerKey: OWNER,
    })
  })
})
