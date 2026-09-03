import type { SearchAddon } from '@xterm/addon-search'
import { cn } from '@/shared/lib/cn'
import { Button } from '@/shared/ui/Button'
import type { TerminalPaneState, TerminalTabState } from '../state/terminal-store'
import { TerminalPane } from './TerminalPane'

const PANE_FLEX_BASE_PERCENT = 100

export interface TerminalPaneGridProps {
  readonly ownerKey: string
  readonly tab: TerminalTabState
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
  const { tab, ownerKey } = props

  return (
    <div
      className={cn('flex h-full', tab.splitDirection === 'side-by-side' ? 'flex-row' : 'flex-col')}
    >
      {tab.panes.map((pane: TerminalPaneState, index: number) => (
        <div
          key={pane.terminalId}
          className={cn(
            'group/pane relative min-h-0 min-w-0',
            index > 0 &&
              (tab.splitDirection === 'side-by-side'
                ? 'border-l border-border'
                : 'border-t border-border'),
          )}
          style={{ flex: `1 1 ${PANE_FLEX_BASE_PERCENT / tab.panes.length}%` }}
        >
          <TerminalPane
            ownerKey={ownerKey}
            terminalId={pane.terminalId}
            cwd={pane.cwd}
            focused={
              props.focusedPaneId === pane.terminalId ||
              (props.focusedPaneId === null && tab.panes.length === 1)
            }
            onFocus={() => props.onFocusPane(pane.terminalId)}
            onSearchAddon={(addon) => props.onSearchAddon(pane.terminalId, addon)}
          />
          {tab.panes.length > 1 && (
            <Button
              size="xs"
              variant="ghost"
              className="absolute right-1.5 bottom-1 z-20 hidden group-hover/pane:block"
              title="Close pane"
              aria-label="Close pane"
              onClick={() => props.onClosePane(pane.terminalId)}
            >
              ✕
            </Button>
          )}
        </div>
      ))}
    </div>
  )
}
