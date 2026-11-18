import type {
  TerminalActivitySummary,
  TerminalOwnerKey,
  TerminalPortPreview,
  TerminalRuntimeEvent,
} from '@shared/types/terminal'
import type { TerminalLaunchEnvironment } from '../lib/terminal-launch-environment'

export type TerminalSplitDirection = 'side-by-side' | 'stacked'

export interface TerminalPaneState {
  /** Client-chosen terminal id, unique per owner. */
  readonly terminalId: string
  /** Launch context Working path, fixed at creation. */
  readonly cwd: string
  /** Optional launch-only environment, used by project action terminals. */
  readonly launchEnv?: TerminalLaunchEnvironment
}

export interface TerminalTabState {
  readonly id: string
  readonly panes: readonly TerminalPaneState[]
  readonly activePaneId: string
  readonly splitDirection: TerminalSplitDirection
  readonly customName: string | null
}

export interface TerminalGroupState {
  readonly tabs: readonly TerminalTabState[]
  readonly activeTabId: string | null
  readonly panelOpen: boolean
  readonly panelHeight: number
}

export interface TerminalState {
  readonly groups: Record<TerminalOwnerKey, TerminalGroupState>
  /** Keyed by runtimeKeyOf: foreground process, listening ports, last exit. */
  readonly activity: Record<string, string | null>
  readonly portPreviews: Record<string, readonly TerminalPortPreview[]>
  readonly exits: Record<string, number>
  createTerminal: (
    ownerKey: TerminalOwnerKey,
    cwd: string,
    launchEnv?: TerminalLaunchEnvironment,
  ) => string | null
  ensureTerminal: (
    ownerKey: TerminalOwnerKey,
    terminalId: string,
    cwd: string,
    options?: {
      readonly launchEnv?: TerminalLaunchEnvironment
      readonly customName?: string
    },
  ) => void
  splitTerminal: (
    ownerKey: TerminalOwnerKey,
    tabId: string,
    cwd: string,
    launchEnv?: TerminalLaunchEnvironment,
  ) => string | null
  setSplitDirection: (
    ownerKey: TerminalOwnerKey,
    tabId: string,
    direction: TerminalSplitDirection,
  ) => void
  closePane: (ownerKey: TerminalOwnerKey, terminalId: string) => void
  closeTab: (ownerKey: TerminalOwnerKey, tabId: string) => readonly string[]
  moveTab: (fromOwnerKey: TerminalOwnerKey, toOwnerKey: TerminalOwnerKey, tabId: string) => void
  moveAllTabs: (fromOwnerKey: TerminalOwnerKey, toOwnerKey: TerminalOwnerKey) => void
  renameTab: (ownerKey: TerminalOwnerKey, tabId: string, name: string | null) => void
  setActiveTab: (ownerKey: TerminalOwnerKey, tabId: string) => void
  setActivePane: (ownerKey: TerminalOwnerKey, tabId: string, terminalId: string) => void
  setPaneCwd: (ownerKey: TerminalOwnerKey, terminalId: string, cwd: string) => void
  setPaneLaunchEnv: (
    ownerKey: TerminalOwnerKey,
    terminalId: string,
    launchEnv: TerminalLaunchEnvironment,
  ) => void
  setPanelOpen: (ownerKey: TerminalOwnerKey, open: boolean) => void
  removeGroup: (ownerKey: TerminalOwnerKey) => void
  clearOwnerRuntimeMetadata: (ownerKey: TerminalOwnerKey) => void
  removeOwner: (ownerKey: TerminalOwnerKey) => void
  migrateGroup: (fromOwnerKey: TerminalOwnerKey, toOwnerKey: TerminalOwnerKey) => void
  rekeyRuntimeMetadata: (
    fromOwnerKey: TerminalOwnerKey,
    toOwnerKey: TerminalOwnerKey,
    terminalIds: readonly string[],
  ) => void
  setPanelHeight: (ownerKey: TerminalOwnerKey, height: number) => void
  applyRuntimeEvent: (
    ownerKey: TerminalOwnerKey,
    terminalId: string,
    event: TerminalRuntimeEvent,
  ) => void
  /** Replace process/port metadata from main's full global snapshot. */
  applyRuntimeSnapshot: (summaries: readonly TerminalActivitySummary[], truncated: boolean) => void
  clearExit: (ownerKey: TerminalOwnerKey, terminalId: string) => void
}

export type TerminalStateSetter = (
  partial: Partial<TerminalState> | ((state: TerminalState) => Partial<TerminalState>),
) => void

export type TerminalStateGetter = () => TerminalState
