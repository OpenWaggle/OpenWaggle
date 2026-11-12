import { DEFAULT_SETTINGS } from '@shared/types/settings'
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useChatStore } from '@/features/chat/state'
import { usePreferencesStore } from '@/features/settings/state'
import { useRightSidebarCoordinator } from '@/shared/lib/right-sidebar-coordinator'
import { useUIStore } from '@/shell/ui-store'
import {
  showWorkspaceSideTerminal,
  useWorkspaceSideTerminalVisible,
} from '@/shell/workspace-panel-actions'
import { deleteWorkspaceOwner } from '@/shell/workspace-panel-cleanup'
import {
  rememberTerminalLayoutFocus,
  resetTerminalLayoutFocusForTests,
} from '../../lib/terminal-focus-location'
import { terminalSidePanelLayoutKey } from '../../lib/terminal-owner'
import { useActionOutputViewStore } from '../../state/action-output-view-store'
import { useTerminalStore } from '../../state/terminal-store'

const ipc = vi.hoisted(() => ({
  assessTerminalClose: vi.fn(async () => ({ disposition: 'safe' as const, reason: 'idle' })),
  closeTerminal: vi.fn(async () => undefined),
}))

vi.mock('@/shared/lib/ipc', async () => ({
  api: (await import('@/test-utils/preload-api')).preloadApi(ipc),
}))

import { useTerminalCommands } from '../useTerminalCommands'

/*
 * Only the preload is replaced: the project, chat, terminal, Right panel and toast stores and the
 * close confirmation are the real ones, so each case asserts where a command lands.
 */
const OWNER = 'draft:/repo'
const SIDE_OWNER = terminalSidePanelLayoutKey(OWNER)

const terminals = () => useTerminalStore.getState().groups

/** Whether the Session's Right panel is maximized in the layout the app persists for relaunch. */
function persistedMaximized() {
  const stored: unknown = JSON.parse(localStorage.getItem('openwaggle:workspace-panel:v1') ?? '{}')
  const state: unknown = Reflect.get(Object(stored), 'state')
  const groups: unknown = Reflect.get(Object(state), 'groups')
  const group: unknown = Reflect.get(Object(groups), OWNER)
  return Reflect.get(Object(group), 'maximized') === true
}

/** The commands, and whether the Right panel shows the Session's terminal. */
function renderCommands() {
  return renderHook(() => ({
    ...useTerminalCommands(),
    sideTerminalShown: useWorkspaceSideTerminalVisible(OWNER),
  }))
}

async function resetStores() {
  // Features may not read the shell's panel store (openwaggle/renderer-import-boundaries); its
  // public cleanup drops the group.
  await deleteWorkspaceOwner(OWNER)
  localStorage.clear()
  resetTerminalLayoutFocusForTests()
  useTerminalStore.setState({ groups: {}, activity: {}, portPreviews: {}, exits: {} })
  useActionOutputViewStore.setState({ views: {}, active: {} })
  useRightSidebarCoordinator.setState({ activeClaim: null })
  useChatStore.setState(useChatStore.getInitialState())
  useUIStore.getState().clearToast()
  usePreferencesStore.setState({
    settings: { ...DEFAULT_SETTINGS, projectPath: '/repo' },
    isLoaded: true,
    loadError: null,
  })
}

describe('useTerminalCommands focused layout routing', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    await resetStores()
  })

  afterEach(resetStores)

  it('routes new, split, and close commands to the focused side terminal group', async () => {
    useTerminalStore.getState().createTerminal(OWNER, '/repo')
    useTerminalStore.getState().createTerminal(SIDE_OWNER, '/repo')
    rememberTerminalLayoutFocus(OWNER, SIDE_OWNER)
    const { result } = renderCommands()

    act(() => result.current.newTerminal())
    expect(terminals()[SIDE_OWNER]?.tabs).toHaveLength(2)
    expect(terminals()[OWNER]?.tabs).toHaveLength(1)
    expect(result.current.sideTerminalShown).toBe(true)

    act(() => result.current.splitTerminalVertical())
    expect(terminals()[SIDE_OWNER]?.tabs[1]?.panes).toHaveLength(2)
    expect(terminals()[SIDE_OWNER]?.tabs[1]?.splitDirection).toBe('stacked')

    const activePaneId = terminals()[SIDE_OWNER]?.tabs[1]?.activePaneId
    await act(() => result.current.closeActiveTerminal())
    // The runtime owner, not the side-panel layout key, owns the process.
    expect(ipc.closeTerminal).toHaveBeenCalledWith(OWNER, activePaneId, true)
    expect(
      terminals()[SIDE_OWNER]?.tabs[1]?.panes.some((pane) => pane.terminalId === activePaneId),
    ).toBe(false)
  })

  it('falls back to a visible drawer when focus is outside the terminal', () => {
    useTerminalStore.getState().createTerminal(OWNER, '/repo')
    useTerminalStore.getState().setPanelOpen(OWNER, true)
    useTerminalStore.getState().createTerminal(SIDE_OWNER, '/repo')
    const { result } = renderCommands()

    act(() => result.current.newTerminal())

    expect(terminals()[OWNER]?.tabs).toHaveLength(2)
    expect(terminals()[SIDE_OWNER]?.tabs).toHaveLength(1)
  })

  it('toggles a visible docked terminal without creating a bottom terminal', () => {
    useTerminalStore.getState().createTerminal(SIDE_OWNER, '/repo')
    useTerminalStore.getState().setPanelOpen(SIDE_OWNER, true)
    showWorkspaceSideTerminal(OWNER)
    const { result } = renderCommands()

    expect(result.current.panelOpen).toBe(true)
    act(() => result.current.toggleTerminal())

    expect(terminals()[SIDE_OWNER]?.panelOpen).toBe(false)
    expect(terminals()[OWNER]).toBeUndefined()
    expect(result.current.sideTerminalShown).toBe(false)
    expect(result.current.panelOpen).toBe(false)
  })

  it('creates, reveals, and retains command focus in a new side-panel terminal group', () => {
    const { result } = renderCommands()

    act(() => result.current.newSideTerminal())

    expect(terminals()[SIDE_OWNER]).toMatchObject({
      panelOpen: true,
      tabs: [expect.objectContaining({ panes: [expect.objectContaining({ cwd: '/repo' })] })],
    })
    expect(result.current.sideTerminalShown).toBe(true)

    act(() => result.current.newTerminal())
    expect(terminals()[SIDE_OWNER]?.tabs).toHaveLength(2)
    expect(terminals()[OWNER]).toBeUndefined()
  })

  it('reports why the Right panel cannot be maximized, and maximizes it otherwise', () => {
    const { result } = renderCommands()

    act(() => result.current.toggleSidePanelMaximized())
    expect(useUIStore.getState().toastData).toMatchObject({
      message: 'Open a panel first.',
      variant: 'error',
    })
    expect(persistedMaximized()).toBe(false)

    act(() => result.current.newSideTerminal())
    act(() => result.current.toggleSidePanelMaximized())
    expect(persistedMaximized()).toBe(true)
  })
})
