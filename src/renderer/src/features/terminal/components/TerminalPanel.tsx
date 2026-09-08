import type { SearchAddon } from '@xterm/addon-search'
import { useRef, useState } from 'react'
import { Button } from '@/shared/ui/Button'
import { useTerminalPanelCloseActions } from '../hooks/useTerminalPanelActions'
import type { TerminalContextProvenance } from '../lib/terminal-context'
import {
  type TerminalGroupState,
  type TerminalTabState,
  useTerminalStore,
} from '../state/terminal-store'
import { TerminalPaneGrid } from './TerminalPaneGrid'
import { TerminalPanelHeader } from './TerminalPanelHeader'
import { TerminalSearchBar } from './TerminalSearchBar'

interface TerminalPanelProps {
  /** Renderer layout bucket; the side panel uses a distinct bucket. */
  readonly ownerKey: string
  /** Session/draft owner used by the PTY runtime. Defaults to ownerKey. */
  readonly runtimeOwnerKey?: string
  readonly defaultCwd: string | null
  readonly defaultProvenance?: TerminalContextProvenance
  readonly onClose: () => void
  readonly closePanelLabel?: string
  readonly onDockActiveTab?: (tabId: string) => void
}

/** The Session terminal panel: tab strip, split panes, search, port previews. */
export function TerminalPanel(props: TerminalPanelProps) {
  const options = normalizePanelProps(props)
  const group = useTerminalStore((state) => state.groups[options.ownerKey])
  const setActivePane = useTerminalStore((state) => state.setActivePane)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchAddons, setSearchAddons] = useState<ReadonlyMap<string, SearchAddon>>(
    () => new Map(),
  )
  const panelRef = useRef<HTMLDivElement>(null)
  const activeTab = resolveActiveTab(group)
  const focusedPaneId = activeTab?.activePaneId ?? null

  // A stale focus (pane unmounted after a tab switch) must not enable search
  // against a missing addon: resolve within the active tab's panes only.
  const searchTargetPane = resolveSearchTarget(activeTab, focusedPaneId)
  const closeActions = useTerminalPanelCloseActions({
    group,
    ownerKey: options.ownerKey,
    runtimeOwnerKey: options.runtimeOwnerKey,
  })
  if (options.ownerKey.length === 0 || options.defaultCwd === null) return <TerminalUnavailable />

  const restoreTerminalFocus = () => {
    const pane = [
      ...(panelRef.current?.querySelectorAll<HTMLElement>('[data-terminal-pane]') ?? []),
    ].find((candidate) => candidate.dataset.terminalPane === searchTargetPane)
    pane?.querySelector<HTMLTextAreaElement>('textarea.xterm-helper-textarea')?.focus()
  }

  return (
    <div ref={panelRef} className="flex h-full flex-col overflow-hidden bg-bg">
      <TerminalPanelHeader
        model={{
          ownerKey: options.ownerKey,
          runtimeOwnerKey: options.runtimeOwnerKey,
          activeTab,
          defaultCwd: options.defaultCwd,
          focusedPaneId,
          searchOpen,
          closePanelLabel: options.closePanelLabel,
        }}
        actions={{
          setSearchOpen,
          setFocusedPaneId: (terminalId) => {
            if (terminalId === null || activeTab === null) return
            setActivePane(options.ownerKey, activeTab.id, terminalId)
          },
          onClosePanel: options.onClose,
          onCloseTab: (tab) => void closeActions.closeOneTab(tab),
          onDockActiveTab: options.onDockActiveTab,
        }}
      />
      {searchOpen && searchTargetPane !== null && (
        <TerminalSearchBar
          addon={searchAddons.get(searchTargetPane) ?? null}
          onDismiss={() => {
            setSearchOpen(false)
            requestAnimationFrame(restoreTerminalFocus)
          }}
        />
      )}
      <div className="relative min-h-0 flex-1">
        {activeTab === null ? (
          <TerminalEmptyState ownerKey={options.ownerKey} defaultCwd={options.defaultCwd} />
        ) : (
          <TerminalPaneGrid
            model={{
              ownerKey: options.ownerKey,
              runtimeOwnerKey: options.runtimeOwnerKey,
              defaultCwd: options.defaultCwd,
              defaultProvenance: options.defaultProvenance,
              tab: activeTab,
            }}
            focusedPaneId={focusedPaneId}
            onFocusPane={(terminalId) => setActivePane(options.ownerKey, activeTab.id, terminalId)}
            onClosePane={(terminalId) => void closeActions.closeOnePane(terminalId)}
            onSearchAddon={(terminalId, addon) => {
              setSearchAddons((current) => {
                if (
                  current.get(terminalId) === addon ||
                  (addon === null && !current.has(terminalId))
                ) {
                  return current
                }
                const next = new Map(current)
                if (addon === null) next.delete(terminalId)
                else next.set(terminalId, addon)
                return next
              })
            }}
          />
        )}
      </div>
    </div>
  )
}

function normalizePanelProps(props: TerminalPanelProps) {
  return {
    ...props,
    runtimeOwnerKey: props.runtimeOwnerKey ?? props.ownerKey,
    defaultProvenance:
      props.defaultProvenance ??
      (props.ownerKey.startsWith('draft:') ? 'draft-checkout' : 'opened-checkout'),
    closePanelLabel: props.closePanelLabel ?? 'Close terminal panel',
  }
}

function resolveSearchTarget(activeTab: TerminalTabState | null, focusedPaneId: string | null) {
  if (
    focusedPaneId !== null &&
    activeTab?.panes.some((pane) => pane.terminalId === focusedPaneId)
  ) {
    return focusedPaneId
  }
  return activeTab?.panes[0]?.terminalId ?? null
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
