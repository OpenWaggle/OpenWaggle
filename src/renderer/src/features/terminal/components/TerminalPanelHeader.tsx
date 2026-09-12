import { TERMINAL } from '@shared/constants/resource-limits'
import type { ShortcutCommand, ShortcutRules } from '@shared/types/shortcuts'
import { activeShortcutRuleForCommand } from '@shared/utils/shortcut-rules'
import { usePreferencesStore } from '@/features/settings/state'
import { api } from '@/shared/lib/ipc'
import {
  formatAriaShortcutBinding,
  formatShortcutBinding,
  usesAppleShortcuts,
} from '@/shared/lib/shortcut-display'
import { Button } from '@/shared/ui/Button'
import { useUIStore } from '@/shell/ui-store'
import { type TerminalTabState, useTerminalStore } from '../state/terminal-store'
import { TerminalTabStrip } from './TerminalTabStrip'

const STACK_ICON = '▤'
const SIDE_BY_SIDE_ICON = '▥'

interface TerminalPanelHeaderProps {
  readonly model: {
    readonly ownerKey: string
    readonly runtimeOwnerKey: string
    readonly activeTab: TerminalTabState | null
    readonly defaultCwd: string | null
    readonly focusedPaneId: string | null
    readonly searchOpen: boolean
    readonly closePanelLabel: string
  }
  readonly actions: {
    readonly setSearchOpen: (update: (open: boolean) => boolean) => void
    readonly setFocusedPaneId: (terminalId: string | null) => void
    readonly onClosePanel: () => void
    readonly onCloseTab: (tab: TerminalTabState) => void
    readonly onDockActiveTab?: (tabId: string) => void
  }
}

/**
 * Panel header: tab strip plus the new/split/direction/search/close actions.
 * Store-driven so the panel component stays a thin composition root.
 */
export function TerminalPanelHeader(props: TerminalPanelHeaderProps) {
  const { model, actions } = props
  const group = useTerminalStore((state) => state.groups[model.ownerKey])
  const activity = useTerminalStore((state) => state.activity)
  const createTerminal = useTerminalStore((state) => state.createTerminal)
  const splitTerminal = useTerminalStore((state) => state.splitTerminal)
  const renameTab = useTerminalStore((state) => state.renameTab)
  const setActiveTab = useTerminalStore((state) => state.setActiveTab)
  const setSplitDirection = useTerminalStore((state) => state.setSplitDirection)
  const showToast = useUIStore((state) => state.showToast)
  const shortcutRules = usePreferencesStore((state) => state.settings.shortcutRules)

  const newTerminal = () => {
    if (model.defaultCwd === null) return
    const terminalId = createTerminal(model.ownerKey, model.defaultCwd)
    if (terminalId !== null) actions.setFocusedPaneId(terminalId)
  }

  const splitActiveTab = (direction: 'side-by-side' | 'stacked') => {
    if (model.activeTab === null || model.defaultCwd === null) return
    setSplitDirection(model.ownerKey, model.activeTab.id, direction)
    const terminalId = splitTerminal(model.ownerKey, model.activeTab.id, model.defaultCwd)
    if (terminalId !== null) actions.setFocusedPaneId(terminalId)
  }

  const searchTarget = model.focusedPaneId ?? model.activeTab?.panes[0]?.terminalId ?? null
  const activeTabId = model.activeTab?.id
  const onDockActiveTab = actions.onDockActiveTab
  const dockActiveTab =
    activeTabId === undefined || onDockActiveTab === undefined
      ? undefined
      : () => onDockActiveTab(activeTabId)

  return (
    <div className="flex items-center gap-1 border-b border-border px-2 py-1">
      <TerminalTabStrip
        ownerKey={model.runtimeOwnerKey}
        tabs={group?.tabs ?? []}
        activeTabId={group?.activeTabId ?? null}
        activity={activity}
        onSelectTab={(tabId) => setActiveTab(model.ownerKey, tabId)}
        onCloseTab={(tabId) => {
          const tab = group?.tabs.find((candidate) => candidate.id === tabId)
          if (tab !== undefined) actions.onCloseTab(tab)
        }}
        onRenameTab={(tabId, name) => renameTab(model.ownerKey, tabId, name)}
      />
      <HeaderActions
        tab={model.activeTab}
        paneTools={{
          searchEnabled: searchTarget !== null && !model.searchOpen,
          onToggleSearch: () => actions.setSearchOpen((open) => !open),
          onClear: () => {
            if (searchTarget === null) return
            void api.clearTerminal(model.runtimeOwnerKey, searchTarget).catch((error: unknown) => {
              showToast(
                error instanceof Error ? error.message : 'Terminal could not be cleared.',
                'error',
              )
            })
          },
        }}
        commands={{
          newTerminal,
          splitSideBySide: () => splitActiveTab('side-by-side'),
          splitVertical: () => splitActiveTab('stacked'),
          dockActiveTab,
          closePanel: actions.onClosePanel,
        }}
        closePanelLabel={model.closePanelLabel}
        shortcutRules={shortcutRules}
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
  readonly commands: {
    readonly newTerminal: () => void
    readonly splitSideBySide: () => void
    readonly splitVertical: () => void
    readonly dockActiveTab?: () => void
    readonly closePanel: () => void
  }
  readonly closePanelLabel: string
  readonly shortcutRules: ShortcutRules
}

function terminalHeaderShortcutContext() {
  return {
    terminalFocus: true,
    terminalOpen: true,
    previewFocus: false,
    previewOpen: document.querySelector('[data-browser-preview-panel]') !== null,
    modelPickerOpen: false,
  }
}

function terminalShortcutBinding(
  shortcutRules: ShortcutRules,
  command: ShortcutCommand,
  context: ReturnType<typeof terminalHeaderShortcutContext>,
) {
  return (
    activeShortcutRuleForCommand(shortcutRules, command, context, usesAppleShortcuts())?.shortcut ??
    null
  )
}

function HeaderActions(props: HeaderActionsProps) {
  const tab = props.tab
  const atPaneLimit = (tab?.panes.length ?? 0) >= TERMINAL.MAX_PANES_PER_TAB
  const terminalContext = terminalHeaderShortcutContext()
  const newTerminalBinding = terminalShortcutBinding(
    props.shortcutRules,
    'terminal.new',
    terminalContext,
  )
  const splitBinding = terminalShortcutBinding(
    props.shortcutRules,
    'terminal.split',
    terminalContext,
  )
  const splitVerticalBinding = terminalShortcutBinding(
    props.shortcutRules,
    'terminal.splitVertical',
    terminalContext,
  )
  const newTerminalTitle = shortcutTitle('New terminal', newTerminalBinding)
  const splitSideTitle = atPaneLimit
    ? `Split terminal side by side unavailable — maximum ${String(TERMINAL.MAX_PANES_PER_TAB)} panes`
    : shortcutTitle('Split terminal side by side', splitBinding)
  const splitVerticalTitle = atPaneLimit
    ? `Split terminal vertically unavailable — maximum ${String(TERMINAL.MAX_PANES_PER_TAB)} panes`
    : shortcutTitle('Split terminal vertically', splitVerticalBinding)
  return (
    <div className="flex shrink-0 items-center gap-0.5">
      <Button
        size="icon-sm"
        variant="ghost"
        title={newTerminalTitle}
        aria-label="New terminal"
        aria-keyshortcuts={formatAriaShortcutBinding(newTerminalBinding)}
        onClick={props.commands.newTerminal}
      >
        +
      </Button>
      <Button
        size="icon-sm"
        variant="ghost"
        title={splitSideTitle}
        aria-label={atPaneLimit ? splitSideTitle : 'Split terminal side by side'}
        aria-keyshortcuts={formatAriaShortcutBinding(splitBinding)}
        disabled={tab === null || atPaneLimit}
        onClick={props.commands.splitSideBySide}
      >
        {SIDE_BY_SIDE_ICON}
      </Button>
      <Button
        size="icon-sm"
        variant="ghost"
        title={splitVerticalTitle}
        aria-label={atPaneLimit ? splitVerticalTitle : 'Split terminal vertically'}
        aria-keyshortcuts={formatAriaShortcutBinding(splitVerticalBinding)}
        disabled={tab === null || atPaneLimit}
        onClick={props.commands.splitVertical}
      >
        {STACK_ICON}
      </Button>
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
      {props.commands.dockActiveTab !== undefined && (
        <Button
          size="icon-sm"
          variant="ghost"
          title="Open active terminal in side panel"
          aria-label="Open active terminal in side panel"
          onClick={props.commands.dockActiveTab}
        >
          ⇥
        </Button>
      )}
      <Button
        size="icon-sm"
        variant="ghost"
        title={props.closePanelLabel}
        aria-label={props.closePanelLabel}
        onClick={props.commands.closePanel}
      >
        ✕
      </Button>
    </div>
  )
}

function shortcutTitle(label: string, binding: Parameters<typeof formatShortcutBinding>[0]) {
  return `${label} (${formatShortcutBinding(binding)})`
}
