import type { SearchAddon } from '@xterm/addon-search'
import { useRef, useState } from 'react'
import { useChat } from '@/features/chat/hooks'
import { useProject } from '@/features/sessions/hooks'
import { api } from '@/shared/lib/ipc'
import { Button } from '@/shared/ui/Button'
import { terminalOwnerContext } from '../lib/terminal-owner'
import {
  type TerminalGroupState,
  type TerminalTabState,
  useTerminalStore,
} from '../state/terminal-store'
import { TerminalPaneGrid } from './TerminalPaneGrid'
import { TerminalPanelHeader } from './TerminalPanelHeader'
import { TerminalSearchBar } from './TerminalSearchBar'

interface TerminalPanelProps {
  readonly onClose: () => void
}

/** The Session terminal panel: tab strip, split panes, search, port previews. */
export function TerminalPanel({ onClose }: TerminalPanelProps) {
  const { activeSession } = useChat()
  const { projectPath } = useProject()
  const owner = terminalOwnerContext(activeSession, projectPath)
  const group = useTerminalStore((state) =>
    owner.ownerKey.length > 0 ? state.groups[owner.ownerKey] : undefined,
  )
  const closePane = useTerminalStore((state) => state.closePane)

  const [focusedPaneId, setFocusedPaneId] = useState<string | null>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const searchAddonsRef = useRef(new Map<string, SearchAddon>())

  if (owner.ownerKey.length === 0 || owner.defaultCwd === null) {
    return <TerminalUnavailable />
  }

  const activeTab = resolveActiveTab(group)

  // A stale focus (pane unmounted after a tab switch) must not enable search
  // against a missing addon: resolve within the active tab's panes only.
  const activePaneIds = new Set(activeTab?.panes.map((pane) => pane.terminalId) ?? [])
  const searchTargetPane =
    focusedPaneId !== null && activePaneIds.has(focusedPaneId)
      ? focusedPaneId
      : (activeTab?.panes[0]?.terminalId ?? null)

  const closeOnePane = (terminalId: string) => {
    closePane(owner.ownerKey, terminalId)
    // Explicit close kills the shell and drops its scrollback; the pane's own
    // unmount detach only detaches (hidden panes keep running).
    void api.closeTerminal(owner.ownerKey, terminalId, true)
    if (focusedPaneId === terminalId) setFocusedPaneId(null)
  }

  return (
    <div className="flex h-full flex-col overflow-hidden bg-bg">
      <TerminalPanelHeader
        ownerKey={owner.ownerKey}
        activeTab={activeTab}
        defaultCwd={owner.defaultCwd}
        focusedPaneId={focusedPaneId}
        searchOpen={searchOpen}
        setSearchOpen={setSearchOpen}
        setFocusedPaneId={setFocusedPaneId}
        onClosePanel={onClose}
      />
      {searchOpen && searchTargetPane !== null && (
        <TerminalSearchBar
          addon={searchAddonsRef.current.get(searchTargetPane) ?? null}
          onDismiss={() => setSearchOpen(false)}
        />
      )}
      <div className="relative min-h-0 flex-1">
        {activeTab === null ? (
          <TerminalEmptyState ownerKey={owner.ownerKey} defaultCwd={owner.defaultCwd} />
        ) : (
          <TerminalPaneGrid
            ownerKey={owner.ownerKey}
            tab={activeTab}
            focusedPaneId={focusedPaneId}
            onFocusPane={setFocusedPaneId}
            onClosePane={closeOnePane}
            onSearchAddon={(terminalId, addon) => {
              if (addon === null) searchAddonsRef.current.delete(terminalId)
              else searchAddonsRef.current.set(terminalId, addon)
            }}
          />
        )}
      </div>
    </div>
  )
}

function resolveActiveTab(group: TerminalGroupState | undefined): TerminalTabState | null {
  if (group === undefined || group.tabs.length === 0) return null
  return (
    group.tabs.find((tab) => tab.id === group.activeTabId) ??
    group.tabs[group.tabs.length - 1] ??
    null
  )
}

function TerminalUnavailable() {
  return (
    <div className="flex h-full flex-col items-center justify-center bg-bg text-text-muted">
      <p className="text-sm">Open a project to use the terminal</p>
    </div>
  )
}

function TerminalEmptyState(props: { readonly ownerKey: string; readonly defaultCwd: string }) {
  const createTerminal = useTerminalStore((state) => state.createTerminal)
  const onNewTerminal = () => {
    const terminalId = createTerminal(props.ownerKey, props.defaultCwd)
    void terminalId
  }
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 text-text-muted">
      <p className="text-sm">No terminal for this session yet</p>
      <p className="text-xs">
        New terminals run in <span className="text-text-secondary">{props.defaultCwd}</span>
      </p>
      <Button size="sm" variant="secondary" onClick={onNewTerminal}>
        New terminal
      </Button>
    </div>
  )
}
