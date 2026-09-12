import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  rememberTerminalLayoutFocus,
  resetTerminalLayoutFocusForTests,
} from '../../lib/terminal-focus-location'
import { terminalSidePanelLayoutKey } from '../../lib/terminal-owner'
import { useTerminalStore } from '../../state/terminal-store'

const mocks = vi.hoisted(() => ({
  closeTerminals: vi.fn(),
  hideSideTerminal: vi.fn(),
  sideTerminalVisible: false,
  showSideTerminal: vi.fn(),
  showToast: vi.fn(),
  togglePanelMaximized: vi.fn(),
}))

vi.mock('@/features/chat/hooks', () => ({ useChat: () => ({ activeSession: null }) }))
vi.mock('@/features/sessions/hooks', () => ({
  useProject: () => ({ projectPath: '/repo' }),
}))
vi.mock('@/shell/workspace-panel-actions', () => ({
  hideWorkspaceSideTerminal: mocks.hideSideTerminal,
  showWorkspaceSideTerminal: mocks.showSideTerminal,
  toggleWorkspacePanelMaximized: mocks.togglePanelMaximized,
  useWorkspaceSideTerminalVisible: () => mocks.sideTerminalVisible,
}))
vi.mock('@/shell/ui-store', () => ({
  useUIStore: (selector: (state: { showToast: typeof mocks.showToast }) => unknown) =>
    selector({ showToast: mocks.showToast }),
}))
vi.mock('../../lib/terminal-close', () => ({
  confirmAndCloseTerminals: mocks.closeTerminals,
}))

import { useTerminalCommands } from '../useTerminalCommands'

const OWNER = 'draft:/repo'
const SIDE_OWNER = terminalSidePanelLayoutKey(OWNER)

describe('useTerminalCommands focused layout routing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.sideTerminalVisible = false
    resetTerminalLayoutFocusForTests()
    useTerminalStore.setState({ groups: {}, activity: {}, portPreviews: {}, exits: {} })
    mocks.closeTerminals.mockResolvedValue('closed')
    mocks.togglePanelMaximized.mockReturnValue(true)
  })

  it('routes new, split, and close commands to the focused side terminal group', async () => {
    useTerminalStore.getState().createTerminal(OWNER, '/repo')
    useTerminalStore.getState().createTerminal(SIDE_OWNER, '/repo')
    rememberTerminalLayoutFocus(OWNER, SIDE_OWNER)
    const { result } = renderHook(() => useTerminalCommands())

    act(() => result.current.newTerminal())
    expect(useTerminalStore.getState().groups[SIDE_OWNER]?.tabs).toHaveLength(2)
    expect(useTerminalStore.getState().groups[OWNER]?.tabs).toHaveLength(1)
    expect(mocks.showSideTerminal).toHaveBeenCalledWith(OWNER)

    act(() => result.current.splitTerminalVertical())
    expect(useTerminalStore.getState().groups[SIDE_OWNER]?.tabs[1]?.panes).toHaveLength(2)
    expect(useTerminalStore.getState().groups[SIDE_OWNER]?.tabs[1]?.splitDirection).toBe('stacked')

    const activePaneId = useTerminalStore.getState().groups[SIDE_OWNER]?.tabs[1]?.activePaneId
    await act(() => result.current.closeActiveTerminal())
    expect(mocks.closeTerminals).toHaveBeenCalledWith(
      OWNER,
      expect.arrayContaining([expect.objectContaining({ terminalId: activePaneId })]),
    )
    expect(
      useTerminalStore
        .getState()
        .groups[SIDE_OWNER]?.tabs[1]?.panes.some((pane) => pane.terminalId === activePaneId),
    ).toBe(false)
  })

  it('falls back to a visible drawer when focus is outside the terminal', () => {
    useTerminalStore.getState().createTerminal(OWNER, '/repo')
    useTerminalStore.getState().setPanelOpen(OWNER, true)
    useTerminalStore.getState().createTerminal(SIDE_OWNER, '/repo')
    const { result } = renderHook(() => useTerminalCommands())

    act(() => result.current.newTerminal())

    expect(useTerminalStore.getState().groups[OWNER]?.tabs).toHaveLength(2)
    expect(useTerminalStore.getState().groups[SIDE_OWNER]?.tabs).toHaveLength(1)
  })

  it('toggles a visible docked terminal without creating a bottom terminal', () => {
    useTerminalStore.getState().createTerminal(SIDE_OWNER, '/repo')
    useTerminalStore.getState().setPanelOpen(SIDE_OWNER, true)
    mocks.sideTerminalVisible = true
    const { result } = renderHook(() => useTerminalCommands())

    expect(result.current.panelOpen).toBe(true)
    act(() => result.current.toggleTerminal())

    expect(useTerminalStore.getState().groups[SIDE_OWNER]?.panelOpen).toBe(false)
    expect(useTerminalStore.getState().groups[OWNER]).toBeUndefined()
    expect(mocks.hideSideTerminal).toHaveBeenCalledWith(OWNER)
  })

  it('creates, reveals, and retains command focus in a new side-panel terminal group', () => {
    const { result } = renderHook(() => useTerminalCommands())

    act(() => result.current.newSideTerminal())

    expect(useTerminalStore.getState().groups[SIDE_OWNER]).toMatchObject({
      panelOpen: true,
      tabs: [expect.objectContaining({ panes: [expect.objectContaining({ cwd: '/repo' })] })],
    })
    expect(mocks.showSideTerminal).toHaveBeenCalledWith(OWNER)

    act(() => result.current.newTerminal())
    expect(useTerminalStore.getState().groups[SIDE_OWNER]?.tabs).toHaveLength(2)
    expect(useTerminalStore.getState().groups[OWNER]).toBeUndefined()
  })

  it('reports when the workspace panel cannot be maximized', () => {
    mocks.togglePanelMaximized.mockReturnValue(false)
    const { result } = renderHook(() => useTerminalCommands())

    act(() => result.current.toggleSidePanelMaximized())

    expect(mocks.showToast).toHaveBeenCalledWith('Open the workspace side panel first.', 'error')
  })
})
