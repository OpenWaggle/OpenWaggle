import type { SearchAddon } from '@xterm/addon-search'
import type { TerminalContextProvenance } from '../lib/terminal-context'
import type { TerminalLaunchEnvironment } from '../lib/terminal-launch-environment'

export interface TerminalPaneModel {
  /** Renderer layout owner used for pane metadata such as its launch cwd. */
  readonly ownerKey: string
  /** Session/draft owner used for PTY lifecycle and runtime events. */
  readonly runtimeOwnerKey: string
  readonly terminalId: string
  readonly cwd: string
  readonly launchEnv?: TerminalLaunchEnvironment
  readonly defaultCwd: string
  readonly defaultProvenance: TerminalContextProvenance
  readonly label: string
}

export interface TerminalPaneProps {
  readonly pane: TerminalPaneModel
  readonly focused: boolean
  readonly onFocus: () => void
  readonly onSearchAddon: (addon: SearchAddon | null) => void
}
