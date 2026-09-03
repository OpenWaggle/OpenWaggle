import { TERMINAL } from '@shared/constants/resource-limits'
import { api } from '@/shared/lib/ipc'
import { Button } from '@/shared/ui/Button'
import { type TerminalTabState, useTerminalStore } from '../state/terminal-store'
import { TerminalTabStrip } from './TerminalTabStrip'

const SPLIT_ICON = '⧉'
const STACK_ICON = '▤'
const SIDE_BY_SIDE_ICON = '▥'

interface TerminalPanelHeaderProps {
  readonly ownerKey: string
  readonly activeTab: TerminalTabState | null
  readonly defaultCwd: string | null
  readonly focusedPaneId: string | null
  readonly searchOpen: boolean
  readonly setSearchOpen: (update: (open: boolean) => boolean) => void
  readonly setFocusedPaneId: (terminalId: string | null) => void
  readonly onClosePanel: () => void
}

/**
 * Panel header: tab strip plus the new/split/direction/search/close actions.
 * Store-driven so the panel component stays a thin composition root.
 */
export function TerminalPanelHeader(props: TerminalPanelHeaderProps) {
  const group = useTerminalStore((state) => state.groups[props.ownerKey])
  const activity = useTerminalStore((state) => state.activity)
  const createTerminal = useTerminalStore((state) => state.createTerminal)
  const splitTerminal = useTerminalStore((state) => state.splitTerminal)
  const closeTab = useTerminalStore((state) => state.closeTab)
  const renameTab = useTerminalStore((state) => state.renameTab)
  const setActiveTab = useTerminalStore((state) => state.setActiveTab)
  const setSplitDirection = useTerminalStore((state) => state.setSplitDirection)

  const newTerminal = () => {
    if (props.defaultCwd === null) return
    const terminalId = createTerminal(props.ownerKey, props.defaultCwd)
    if (terminalId !== null) props.setFocusedPaneId(terminalId)
  }

  const splitActiveTab = () => {
    if (props.activeTab === null || props.defaultCwd === null) return
    const terminalId = splitTerminal(props.ownerKey, props.activeTab.id, props.defaultCwd)
    if (terminalId !== null) props.setFocusedPaneId(terminalId)
  }

  const searchTarget = props.focusedPaneId ?? props.activeTab?.panes[0]?.terminalId ?? null

  return (
    <div className="flex items-center gap-1 border-b border-border px-2 py-1">
      <TerminalTabStrip
        ownerKey={props.ownerKey}
        tabs={group?.tabs ?? []}
        activeTabId={group?.activeTabId ?? null}
        activity={activity}
        focusedPaneId={props.focusedPaneId}
        onSelectTab={(tabId) => setActiveTab(props.ownerKey, tabId)}
        onCloseTab={(tabId) => {
          for (const terminalId of closeTab(props.ownerKey, tabId)) {
            // Explicit close kills the shell and drops its scrollback.
            void api.closeTerminal(props.ownerKey, terminalId, true)
            if (props.focusedPaneId === terminalId) props.setFocusedPaneId(null)
          }
        }}
        onRenameTab={(tabId, name) => renameTab(props.ownerKey, tabId, name)}
      />
      <HeaderActions
        tab={props.activeTab}
        paneTools={{
          searchEnabled: searchTarget !== null && !props.searchOpen,
          onToggleSearch: () => props.setSearchOpen((open) => !open),
          onClear: () => {
            if (searchTarget === null) return
            void api.clearTerminal(props.ownerKey, searchTarget)
          },
        }}
        onNewTerminal={newTerminal}
        onSplit={splitActiveTab}
        onToggleDirection={() => {
          if (props.activeTab === null) return
          setSplitDirection(
            props.ownerKey,
            props.activeTab.id,
            props.activeTab.splitDirection === 'side-by-side' ? 'stacked' : 'side-by-side',
          )
        }}
        onClosePanel={props.onClosePanel}
      />
    </div>
  )
}

interface PaneTools {
  readonly searchEnabled: boolean
  readonly onToggleSearch: () => void
  readonly onClear: () => void
}

interface HeaderActionsProps {
  readonly tab: TerminalTabState | null
  readonly paneTools: PaneTools
  readonly onNewTerminal: () => void
  readonly onSplit: () => void
  readonly onToggleDirection: () => void
  readonly onClosePanel: () => void
}

function HeaderActions(props: HeaderActionsProps) {
  const tab = props.tab
  const splitDirection = tab?.splitDirection ?? 'side-by-side'

  return (
    <div className="flex shrink-0 items-center gap-0.5">
      <Button
        size="icon-sm"
        variant="ghost"
        title="New terminal"
        aria-label="New terminal"
        onClick={props.onNewTerminal}
      >
        +
      </Button>
      <Button
        size="icon-sm"
        variant="ghost"
        title="Split terminal"
        aria-label="Split terminal"
        disabled={tab === null || tab.panes.length >= TERMINAL.MAX_PANES_PER_TAB}
        onClick={props.onSplit}
      >
        {SPLIT_ICON}
      </Button>
      {tab !== null && tab.panes.length > 1 && (
        <Button
          size="icon-sm"
          variant="ghost"
          title={splitDirection === 'side-by-side' ? 'Stack panes' : 'Panels side by side'}
          onClick={props.onToggleDirection}
        >
          {splitDirection === 'side-by-side' ? STACK_ICON : SIDE_BY_SIDE_ICON}
        </Button>
      )}
      <Button
        size="icon-sm"
        variant="ghost"
        title="Clear terminal"
        aria-label="Clear terminal"
        disabled={props.paneTools.searchEnabled ? false : props.tab === null}
        onClick={props.paneTools.onClear}
      >
        ⌫
      </Button>
      <Button
        size="icon-sm"
        variant="ghost"
        title="Search terminal"
        aria-label="Search terminal"
        disabled={!props.paneTools.searchEnabled}
        onClick={props.paneTools.onToggleSearch}
      >
        ⌕
      </Button>
      <Button size="icon-sm" variant="ghost" title="Close panel" onClick={props.onClosePanel}>
        ✕
      </Button>
    </div>
  )
}
