import { DEFAULT_SETTINGS } from '@shared/types/settings'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { usePreferencesStore } from '@/features/settings/state'
import { openWorkspaceWebLink } from '../open-workspace-web-link'
import { useWorkspacePanelStore } from '../workspace-panel-store'

const apiMocks = vi.hoisted(() => ({
  closeBrowserPreview: vi.fn(async () => undefined),
  openExternal: vi.fn(async () => undefined),
}))

vi.mock('@/shared/lib/ipc', () => ({ api: apiMocks }))

const OWNER = 'session-1'

describe('openWorkspaceWebLink', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    usePreferencesStore.setState({
      settings: DEFAULT_SETTINGS,
      isLoaded: true,
      loadError: null,
    })
    useWorkspacePanelStore.setState({ groups: {} })
  })

  it('uses the system browser by default', async () => {
    await openWorkspaceWebLink(OWNER, 'example.com/docs')

    expect(apiMocks.openExternal).toHaveBeenCalledExactlyOnceWith('https://example.com/docs')
    expect(useWorkspacePanelStore.getState().groups[OWNER]).toBeUndefined()
  })

  it('opens a deduplicated native preview when the app destination is selected', async () => {
    usePreferencesStore.setState({
      settings: { ...DEFAULT_SETTINGS, browserLinkTarget: 'app' },
    })

    await openWorkspaceWebLink(OWNER, 'http://localhost:5173')
    await openWorkspaceWebLink(OWNER, 'http://localhost:5173/')

    const group = useWorkspacePanelStore.getState().groups[OWNER]
    expect(group?.browserTabs).toHaveLength(1)
    expect(group?.browserTabs[0]?.url).toBe('http://localhost:5173/')
    expect(group?.activeSurface?.kind).toBe('browser')
    expect(apiMocks.openExternal).not.toHaveBeenCalled()
  })

  it('closes the native view evicted by the eight-tab cap', async () => {
    usePreferencesStore.setState({
      settings: { ...DEFAULT_SETTINGS, browserLinkTarget: 'app' },
    })
    for (let index = 0; index < 9; index += 1) {
      await openWorkspaceWebLink(OWNER, `https://example.com/${String(index)}`)
    }

    expect(apiMocks.closeBrowserPreview).toHaveBeenCalledOnce()
    expect(useWorkspacePanelStore.getState().groups[OWNER]?.browserTabs).toHaveLength(8)
  })

  it('uses the system browser when a matching in-app preview has already failed', async () => {
    usePreferencesStore.setState({
      settings: { ...DEFAULT_SETTINGS, browserLinkTarget: 'app' },
    })
    await openWorkspaceWebLink(OWNER, 'http://127.0.0.1:5173')
    const previewId = useWorkspacePanelStore.getState().groups[OWNER]?.browserTabs[0]?.id
    if (previewId === undefined) throw new Error('Expected an in-app preview')
    useWorkspacePanelStore.getState().updateBrowser(OWNER, previewId, {
      loading: false,
      error: 'Connection refused',
    })

    await openWorkspaceWebLink(OWNER, 'http://127.0.0.1:5173')

    expect(apiMocks.openExternal).toHaveBeenCalledExactlyOnceWith('http://127.0.0.1:5173/')
  })

  it('rejects non-web schemes before opening either destination', async () => {
    await expect(openWorkspaceWebLink(OWNER, 'file:///etc/passwd')).rejects.toThrow(
      'Only http and https links can be opened.',
    )
    expect(apiMocks.openExternal).not.toHaveBeenCalled()
  })
})
