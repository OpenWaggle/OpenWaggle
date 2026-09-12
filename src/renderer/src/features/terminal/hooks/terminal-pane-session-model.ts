import type { SearchAddon } from '@xterm/addon-search'
import type { RefObject } from 'react'
import type { TerminalLaunchEnvironment } from '../lib/terminal-launch-environment'
import type { TerminalLinkActivationTarget } from '../lib/terminal-links'

export type TerminalPaneStatus = 'ready' | 'cwd-missing' | 'error' | 'stopped'

export interface TerminalPaneSessionOptions {
  readonly ownerKey: string
  readonly terminalId: string
  readonly cwd: string
  readonly launchEnv?: TerminalLaunchEnvironment
  readonly projectRoot: string
  readonly containerRef: RefObject<HTMLDivElement | null>
  readonly onSearchAddon: (addon: SearchAddon | null) => void
  readonly onActivateLink: (target: TerminalLinkActivationTarget) => void
}
