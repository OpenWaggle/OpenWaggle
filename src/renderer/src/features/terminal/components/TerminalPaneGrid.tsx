import { activeShortcutRuleForCommand } from '@shared/utils/shortcut-rules'
import type { SearchAddon } from '@xterm/addon-search'
import { usePreferencesStore } from '@/features/settings/state'
import { cn } from '@/shared/lib/cn'
import {
  formatAriaShortcutBinding,
  formatShortcutBinding,
  usesAppleShortcuts,
} from '@/shared/lib/shortcut-display'
import { Button } from '@/shared/ui/Button'
import type { TerminalContextProvenance } from '../lib/terminal-context'
import { runtimeKeyOf, terminalTabTitle } from '../lib/terminal-owner'
import type { TerminalPaneState, TerminalTabState } from '../state/terminal-store'
import { useTerminalStore } from '../state/terminal-store'
import { TerminalPane } from './TerminalPane'

const PANE_FLEX_BASE_PERCENT = 100

export interface TerminalPaneGridProps {
  readonly model: {
    readonly ownerKey: string
    readonly runtimeOwnerKey: string
    readonly defaultCwd: string
    readonly defaultProvenance: TerminalContextProvenance
    readonly tab: TerminalTabState
  }
  readonly focusedPaneId: string | null
  readonly onFocusPane: (terminalId: string) => void
  readonly onClosePane: (terminalId: string) => void
  readonly onSearchAddon: (terminalId: string, addon: SearchAddon | null) => void
}

/**
 * The active tab's split grid: one TerminalPane per terminal, laid out
 * side-by-side or stacked, capped at MAX_PANES_PER_TAB panes (ADR 0030).
 */
export function TerminalPaneGrid(props: TerminalPaneGridProps) {
  const { tab, ownerKey } = props.model
  const activity = useTerminalStore((state) => state.activity)
  const group = useTerminalStore((state) => state.groups[ownerKey])
  const shortcutRules = usePreferencesStore((state) => state.settings.shortcutRules)
  const closeShortcut =
    activeShortcutRuleForCommand(
      shortcutRules,
      'terminal.close',
      {
        terminalFocus: true,
        terminalOpen: true,
        previewFocus: false,
        previewOpen: document.querySelector('[data-browser-preview-panel]') !== null,
        modelPickerOpen: false,
      },
      usesAppleShortcuts(),
    )?.shortcut ?? null
  const tabIndex = Math.max(0, group?.tabs.findIndex((candidate) => candidate.id === tab.id) ?? 0)
  const tabTitle = terminalTabTitle(
    props.model.runtimeOwnerKey,
    tab,
    tabIndex,
    activity,
    props.focusedPaneId,
  )
  const split = tab.panes.length > 1

  return (
    <div
      className={cn('flex h-full', tab.splitDirection === 'side-by-side' ? 'flex-row' : 'flex-col')}
    >
      {tab.panes.map((pane: TerminalPaneState, index: number) => {
        const processName = terminalPaneProcessName(
          activity,
          props.model.runtimeOwnerKey,
          pane.terminalId,
        )
        const paneTitle = terminalTabTitle(
          props.model.runtimeOwnerKey,
          tab,
          tabIndex,
          activity,
          pane.terminalId,
        )
        return (
          <div
            key={pane.terminalId}
            className={cn(
              'group/pane relative flex min-h-0 min-w-0 flex-col',
              index > 0 &&
                (tab.splitDirection === 'side-by-side'
                  ? 'border-l border-border'
                  : 'border-t border-border'),
            )}
            style={{ flex: `1 1 ${PANE_FLEX_BASE_PERCENT / tab.panes.length}%` }}
          >
            {split && (
              <TerminalPaneIdentity
                closeShortcut={closeShortcut}
                focused={props.focusedPaneId === pane.terminalId}
                index={index}
                pane={pane}
                processName={processName}
                provenance={paneProvenance(pane, props.model)}
                onClose={() => props.onClosePane(pane.terminalId)}
                onFocus={() => props.onFocusPane(pane.terminalId)}
              />
            )}
            <div className="relative min-h-0 flex-1">
              <TerminalPane
                pane={{
                  ownerKey,
                  runtimeOwnerKey: props.model.runtimeOwnerKey,
                  terminalId: pane.terminalId,
                  cwd: pane.cwd,
                  launchEnv: pane.launchEnv,
                  defaultCwd: props.model.defaultCwd,
                  defaultProvenance: props.model.defaultProvenance,
                  label: split ? `${paneTitle} pane ${index + 1}` : tabTitle,
                }}
                focused={props.focusedPaneId === pane.terminalId}
                onFocus={() => props.onFocusPane(pane.terminalId)}
                onSearchAddon={(addon) => props.onSearchAddon(pane.terminalId, addon)}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}

function terminalPaneProcessName(
  activity: Record<string, string | null>,
  runtimeOwnerKey: string,
  terminalId: string,
) {
  return activity[runtimeKeyOf(runtimeOwnerKey, terminalId)]?.trim() || 'Shell'
}

function paneProvenance(
  pane: TerminalPaneState,
  model: TerminalPaneGridProps['model'],
): TerminalContextProvenance {
  return pane.cwd === model.defaultCwd ? model.defaultProvenance : 'original-checkout'
}

const PROVENANCE_LABELS: Readonly<Record<TerminalContextProvenance, string>> = {
  'session-worktree': 'Worktree',
  'original-checkout': 'Original checkout',
  'opened-checkout': 'Checkout',
  'draft-checkout': 'Draft checkout',
}

interface TerminalPaneIdentityProps {
  readonly closeShortcut: Parameters<typeof formatShortcutBinding>[0]
  readonly focused: boolean
  readonly index: number
  readonly pane: TerminalPaneState
  readonly processName: string
  readonly provenance: TerminalContextProvenance
  readonly onClose: () => void
  readonly onFocus: () => void
}

function TerminalPaneIdentity(props: TerminalPaneIdentityProps) {
  const closeTitle = `Close pane (${formatShortcutBinding(props.closeShortcut)})`
  const provenance = PROVENANCE_LABELS[props.provenance]
  return (
    <div
      className={cn(
        'flex h-6 shrink-0 items-center gap-1.5 border-b border-border bg-bg-secondary/55 px-2 text-xs',
        props.focused ? 'text-text-secondary' : 'text-text-muted',
      )}
      data-testid="terminal-pane-identity"
      title={`${props.processName} · ${provenance} · ${props.pane.cwd}`}
      onPointerDown={props.onFocus}
    >
      <span className="shrink-0 font-medium">Pane {props.index + 1}</span>
      <span aria-hidden="true" className="text-text-muted">
        ·
      </span>
      <span className="min-w-0 truncate font-mono">{props.processName}</span>
      <span className="ml-auto shrink-0 text-text-muted">{provenance}</span>
      <Button
        size="none"
        variant="unstyled"
        className="rounded p-0.5 text-text-muted hover:bg-bg-hover hover:text-text-primary"
        title={closeTitle}
        aria-label="Close pane"
        aria-keyshortcuts={formatAriaShortcutBinding(props.closeShortcut)}
        onClick={props.onClose}
      >
        ✕
      </Button>
    </div>
  )
}
