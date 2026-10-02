import type { SearchAddon } from '@xterm/addon-search'
import { useRef, useState } from 'react'
import { Button } from '@/shared/ui/Button'
import { useTerminalPanelCloseActions } from '../hooks/useTerminalPanelActions'
import { type ActionOutputView, actionOutputViewTabId } from '../lib/action-output-view-model'
import type { TerminalContextProvenance } from '../lib/terminal-context'
import { shownActionOutputView, useActionOutputViewStore } from '../state/action-output-view-store'
import {
  type TerminalGroupState,
  type TerminalTabState,
  useTerminalStore,
} from '../state/terminal-store'
import { ActionOutputTerminalView } from './ActionOutputTerminalView'
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
  const { outputViews, shownView, shownViewKey, shownActionId } = useDrawerActionOutputViews(
    options.ownerKey,
    options.runtimeOwnerKey,
    group?.activeTabId ?? null,
  )
  const focusedPaneId = shownViewKey ?? activeTab?.activePaneId ?? null

  // A stale focus (pane unmounted after a tab switch) must not enable search
  // against a missing addon: resolve within the active tab's panes only.
  const searchTargetPane = shownViewKey ?? resolveSearchTarget(activeTab, focusedPaneId)
  const setSearchAddon = (key: string, addon: SearchAddon | null) =>
    setSearchAddons((current) => withSearchAddon(current, key, addon))
  const closeActions = useTerminalPanelCloseActions({
    group,
    ownerKey: options.ownerKey,
    runtimeOwnerKey: options.runtimeOwnerKey,
  })
  if (options.ownerKey.length === 0 || options.defaultCwd === null) return <TerminalUnavailable />

  const restoreTerminalFocus = () =>
    focusTerminalSurface(panelRef.current, shownView === null ? searchTargetPane : null)

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
          actionOutput: { views: outputViews, shownActionId },
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
        {shownView !== null ? (
          <ActionOutputTerminalView
            key={actionOutputViewTabId(shownView)}
            view={shownView}
            cwd={options.defaultCwd}
            onSearchAddon={(addon) => setSearchAddon(actionOutputViewTabId(shownView), addon)}
          />
        ) : activeTab === null ? (
          <TerminalEmptyState
            ownerKey={options.ownerKey}
            defaultCwd={options.defaultCwd}
            hasOutputViews={outputViews.length > 0}
          />
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
            onSearchAddon={setSearchAddon}
          />
        )}
      </div>
    </div>
  )
}

const NO_OUTPUT_VIEWS: readonly ActionOutputView[] = []

function withSearchAddon(
  current: ReadonlyMap<string, SearchAddon>,
  key: string,
  addon: SearchAddon | null,
): ReadonlyMap<string, SearchAddon> {
  if (current.get(key) === addon || (addon === null && !current.has(key))) return current
  const next = new Map(current)
  if (addon === null) next.delete(key)
  else next.set(key, addon)
  return next
}

/** Refocuses a terminal pane by id, or the shown action output view when paneId is null. */
function focusTerminalSurface(panel: HTMLElement | null, paneId: string | null) {
  const surface =
    paneId === null
      ? panel?.querySelector<HTMLElement>('[data-action-output-view]')
      : [...(panel?.querySelectorAll<HTMLElement>('[data-terminal-pane]') ?? [])].find(
          (candidate) => candidate.dataset.terminalPane === paneId,
        )
  surface?.querySelector<HTMLTextAreaElement>('textarea.xterm-helper-textarea')?.focus()
}

/** Action output views live only in the Session's bottom drawer, not the side-panel bucket. */
function useDrawerActionOutputViews(
  ownerKey: string,
  runtimeOwnerKey: string,
  activeTabId: string | null,
) {
  const drawer = ownerKey === runtimeOwnerKey
  const outputViews = useActionOutputViewStore((state) =>
    drawer ? (state.views[ownerKey] ?? NO_OUTPUT_VIEWS) : NO_OUTPUT_VIEWS,
  )
  const shownView = useActionOutputViewStore((state) =>
    drawer ? shownActionOutputView(state, ownerKey, activeTabId) : null,
  )
  return {
    outputViews,
    shownView,
    shownViewKey: shownView === null ? null : actionOutputViewTabId(shownView),
    shownActionId: shownView === null ? null : shownView.actionId,
  }
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

function TerminalEmptyState(props: {
  readonly ownerKey: string
  readonly defaultCwd: string
  readonly hasOutputViews: boolean
}) {
  const createTerminal = useTerminalStore((state) => state.createTerminal)
  const onNewTerminal = () => {
    const terminalId = createTerminal(props.ownerKey, props.defaultCwd)
    void terminalId
  }
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 text-text-muted">
      <p className="text-sm">
        {props.hasOutputViews
          ? 'Choose an action output tab, or start a terminal'
          : 'No terminal for this session yet'}
      </p>
      <p className="text-xs">
        New terminals run in <span className="text-text-secondary">{props.defaultCwd}</span>
      </p>
      <Button size="sm" variant="secondary" onClick={onNewTerminal}>
        New terminal
      </Button>
    </div>
  )
}
