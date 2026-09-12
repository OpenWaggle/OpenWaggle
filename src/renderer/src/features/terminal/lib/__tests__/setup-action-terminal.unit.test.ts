import type { WorktreeSetupActionTerminal } from '@shared/types/background-run'
import { beforeEach, describe, expect, it } from 'vitest'
import { useTerminalStore } from '../../state/terminal-store'
import { reconcileSetupActionTerminal } from '../setup-action-terminal'
import { terminalSidePanelLayoutKey } from '../terminal-owner'

const SESSION_ID = 'session-inactive'
const SETUP_ACTION: WorktreeSetupActionTerminal = {
  terminalId: 'setup-terminal-1',
  actionId: 'setup-action-1',
  actionName: 'Install',
  projectRoot: '/repo',
  cwd: '/repo/.openwaggle/session-inactive',
}

describe('setup action terminal reconciliation', () => {
  beforeEach(() => {
    useTerminalStore.setState({ groups: {}, activity: {}, portPreviews: {}, exits: {} })
  })

  it('creates a visible tab for an inactive session and remains idempotent on repeat delivery', () => {
    expect(reconcileSetupActionTerminal(SESSION_ID, SETUP_ACTION)).toBe(true)
    expect(reconcileSetupActionTerminal(SESSION_ID, SETUP_ACTION)).toBe(true)

    const group = useTerminalStore.getState().groups[SESSION_ID]
    expect(group?.panelOpen).toBe(true)
    expect(group?.tabs).toHaveLength(1)
    expect(group?.tabs[0]).toMatchObject({
      customName: 'Setup · Install',
      panes: [
        {
          terminalId: 'setup-terminal-1',
          cwd: '/repo/.openwaggle/session-inactive',
          launchEnv: {
            OPENWAGGLE_PROJECT_ROOT: '/repo',
            OPENWAGGLE_WORKTREE_PATH: '/repo/.openwaggle/session-inactive',
            T3CODE_PROJECT_ROOT: '/repo',
            T3CODE_WORKTREE_PATH: '/repo/.openwaggle/session-inactive',
          },
        },
      ],
    })
  })

  it('preserves the existing side-panel location across reload or repeated recovery', () => {
    const sideOwner = terminalSidePanelLayoutKey(SESSION_ID)
    useTerminalStore
      .getState()
      .ensureTerminal(sideOwner, SETUP_ACTION.terminalId, SETUP_ACTION.cwd, {
        customName: 'Setup · Install',
      })

    reconcileSetupActionTerminal(SESSION_ID, SETUP_ACTION)

    expect(useTerminalStore.getState().groups[SESSION_ID]).toBeUndefined()
    expect(useTerminalStore.getState().groups[sideOwner]?.tabs).toHaveLength(1)
    expect(
      useTerminalStore.getState().groups[sideOwner]?.tabs[0]?.panes[0]?.launchEnv,
    ).toMatchObject({ OPENWAGGLE_WORKTREE_PATH: SETUP_ACTION.cwd })
  })

  it('does not reopen an existing setup terminal the user closed', () => {
    reconcileSetupActionTerminal(SESSION_ID, SETUP_ACTION)
    useTerminalStore.getState().setPanelOpen(SESSION_ID, false)

    reconcileSetupActionTerminal(SESSION_ID, SETUP_ACTION)

    expect(useTerminalStore.getState().groups[SESSION_ID]?.panelOpen).toBe(false)
  })
})
