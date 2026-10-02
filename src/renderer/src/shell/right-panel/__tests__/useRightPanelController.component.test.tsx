import { act, renderHook } from '@testing-library/react'
import { FileText, GitCompare, LayoutGrid, Play } from 'lucide-react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RightPanelSurfaceId } from '@/shared/lib/right-panel-surfaces'
import { useRightSidebarCoordinator } from '@/shared/lib/right-sidebar-coordinator'
import type { RightPanelModel, RightPanelSurfaceEntry } from '../useRightPanelModel'

const mocks = vi.hoisted(() => {
  const location: { pathname: string; search: Record<string, unknown> } = {
    pathname: '/sessions/session-1',
    search: {},
  }
  return {
    location,
    route: { isChatRoute: true, open: vi.fn(), close: vi.fn() },
    searchWorkspaceFiles: vi.fn(),
  }
})

vi.mock('@tanstack/react-router', () => ({
  useRouterState: ({
    select,
  }: {
    select: (state: { location: typeof mocks.location }) => unknown
  }) => select({ location: mocks.location }),
}))
vi.mock('../useRightPanelRouteNavigation', () => ({
  useRightPanelRouteNavigation: () => mocks.route,
}))
vi.mock('@/shared/lib/ipc', () => ({
  api: { searchWorkspaceFiles: mocks.searchWorkspaceFiles },
}))
vi.mock('../../workspace-panel-actions', () => ({ showWorkspaceBrowser: vi.fn() }))

import { useRightPanelRailStore } from '../right-panel-rail-store'
import { useRightPanelController } from '../useRightPanelController'

const SESSION = 'session-1'

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

function model(overrides: Partial<RightPanelModel> = {}): RightPanelModel {
  const surfaces = [
    entry('all-panels', { group: null }),
    entry('changes', { glyph: { kind: 'lucide', icon: GitCompare } }),
    entry('project-actions', { glyph: { kind: 'lucide', icon: Play } }),
    entry('files', { glyph: { kind: 'lucide', icon: FileText } }),
    entry('session-tree', { group: 'Session' }),
  ]
  return {
    ownerKey: SESSION,
    sessionKey: SESSION,
    projectPath: '/repo',
    shown: { open: false, shown: null, highlight: null, kind: null },
    surfaces,
    railSurfaces: surfaces.slice(1),
    knownRailIds: surfaces.slice(1).map((surface) => surface.id),
    listedRailIds: surfaces.slice(1).map((surface) => surface.id),
    extensionPanels: [],
    extensionRegistryLoaded: true,
    ...overrides,
  }
}

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function remember(surface: RightPanelSurfaceId, open = true) {
  useRightPanelRailStore.getState().rememberSession(SESSION, { open, surface })
}

function routeOpenPanels() {
  return mocks.route.open.mock.calls.map(([search]) => Reflect.get(search, 'panel'))
}

describe('useRightPanelController', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    mocks.location.pathname = `/sessions/${SESSION}`
    mocks.location.search = {}
    useRightSidebarCoordinator.setState({ activeClaim: null })
    useRightPanelRailStore.setState({ sessions: {}, lastSurface: null })
  })
  afterEach(() => vi.useRealTimers())

  it('closes the panel when the shown surface is chosen again', () => {
    useRightSidebarCoordinator.getState().claimRoute('diff')
    const { result } = renderHook(() =>
      useRightPanelController(
        model({ shown: { open: true, shown: 'changes', highlight: 'changes', kind: 'route' } }),
        '/repo',
      ),
    )
    act(() => result.current.toggleSurface('changes'))
    expect(mocks.route.close).toHaveBeenCalled()
    expect(mocks.route.open).not.toHaveBeenCalled()
  })

  it('restores the Session’s remembered surface once its claims settle', () => {
    remember('changes')
    renderHook(() => useRightPanelController(model(), '/repo'))
    expect(mocks.route.open).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(0))
    expect(routeOpenPanels()).toEqual(['diff'])
  })

  it('waits for a remembered surface that is still loading, without a toast', () => {
    remember('session-tree')
    const loading = model({
      surfaces: model().surfaces.map((surface) =>
        surface.id === 'session-tree'
          ? { ...surface, disabledReason: 'Available after the first message' }
          : surface,
      ),
    })
    const { rerender } = renderHook(({ input }) => useRightPanelController(input, '/repo'), {
      initialProps: { input: loading },
    })
    act(() => vi.advanceTimersByTime(100))
    expect(mocks.route.open).not.toHaveBeenCalled()

    rerender({ input: model() })
    act(() => vi.advanceTimersByTime(0))
    expect(routeOpenPanels()).toEqual(['session-tree'])
  })

  it('gives up on a surface that never becomes available and keeps the memory', () => {
    remember('session-tree')
    const unavailable = model({
      surfaces: model().surfaces.filter((surface) => surface.id !== 'session-tree'),
    })
    renderHook(() => useRightPanelController(unavailable, '/repo'))
    act(() => vi.advanceTimersByTime(3000))
    expect(mocks.route.open).not.toHaveBeenCalled()
    // Restored (gave up), so recording resumes with the closed panel.
    expect(useRightPanelRailStore.getState().sessions[SESSION]?.open).toBe(false)
  })

  it('does not record the guided action panel into the Session’s memory', () => {
    remember('changes', false)
    renderHook(() =>
      useRightPanelController(
        model({
          shown: {
            open: true,
            shown: 'project-actions',
            highlight: 'project-actions',
            kind: 'action-panel',
          },
        }),
        '/repo',
      ),
    )
    act(() => vi.advanceTimersByTime(0))
    expect(useRightPanelRailStore.getState().sessions[SESSION]).toMatchObject({
      open: false,
      surface: 'changes',
    })
  })

  it('drops a slow Files lookup once another surface was chosen or the panel closed', async () => {
    remember('files', false)
    useRightPanelRailStore.getState().rememberSession(SESSION, { lastFilePath: 'src/a.ts' })
    const lookup = deferred<{ path: string }[]>()
    mocks.searchWorkspaceFiles.mockReturnValue(lookup.promise)
    const { result } = renderHook(() => useRightPanelController(model(), '/repo'))
    act(() => vi.advanceTimersByTime(0))

    act(() => result.current.showSurface('files'))
    act(() => result.current.showSurface('changes'))
    await act(async () => lookup.resolve([{ path: 'src/a.ts' }]))
    expect(routeOpenPanels()).toEqual(['diff'])

    const second = deferred<{ path: string }[]>()
    mocks.searchWorkspaceFiles.mockReturnValue(second.promise)
    act(() => result.current.showSurface('files'))
    act(() => result.current.closePanel())
    await act(async () => second.resolve([{ path: 'src/a.ts' }]))
    expect(routeOpenPanels()).toEqual(['diff'])
  })

  it('opens the remembered file, or the navigator alone when it is gone', async () => {
    useRightPanelRailStore.getState().rememberSession(SESSION, { lastFilePath: 'src/a.ts' })
    mocks.searchWorkspaceFiles.mockResolvedValueOnce([{ path: 'src/a.ts' }])
    const { result } = renderHook(() => useRightPanelController(model(), '/repo'))
    await act(async () => result.current.showSurface('files'))
    expect(mocks.route.open.mock.calls.at(-1)?.[0]).toEqual({ panel: 'file', filePath: 'src/a.ts' })

    mocks.searchWorkspaceFiles.mockResolvedValueOnce([])
    await act(async () => result.current.showSurface('files'))
    expect(mocks.route.open.mock.calls.at(-1)?.[0]).toEqual({ panel: 'file' })
  })
})
