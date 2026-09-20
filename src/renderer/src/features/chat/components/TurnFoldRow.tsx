import type { ExtensionContributionRegistryView } from '@shared/types/extensions'
import { ChevronRight } from 'lucide-react'
import { ExtensionAgentLoopSurface } from '@/features/extensions'
import { Button } from '@/shared/ui/Button'
import type { TurnFoldChatRow } from '../lib/types-chat-row'
import { selectExpandedTurnKeys, useTurnFoldStore } from '../state/turn-fold-store'

interface TurnFoldRowProps {
  readonly row: TurnFoldChatRow
  readonly sessionId: string | null
  readonly extensions: {
    readonly registry: ExtensionContributionRegistryView | null
    readonly projectPaths: readonly string[]
  }
  readonly onToggleTurnFold: (turnKey: string) => void
}

/** The core fold row shown when no extension contributes the status surface. */
function CoreFoldRow({
  row,
  expanded,
  onToggleTurnFold,
}: {
  readonly row: TurnFoldChatRow
  readonly expanded: boolean
  readonly onToggleTurnFold: (turnKey: string) => void
}) {
  return (
    <Button
      variant="unstyled"
      type="button"
      onClick={() => onToggleTurnFold(row.turnKey)}
      aria-expanded={expanded}
      data-testid="turn-fold-row"
      className="group/fold -ml-2 flex w-fit items-center gap-1.5 rounded-md px-2 py-1 text-xs text-text-tertiary transition-colors hover:text-text-secondary"
    >
      <ChevronRight
        className={`size-3.5 shrink-0 transition-transform ${expanded ? 'rotate-90' : ''}`}
      />
      <span>{row.label}</span>
    </Button>
  )
}

/**
 * The quiet row standing in for one settled turn's work (ADR 0034).
 * Clicking re-expands the turn's full activity above the terminal message.
 * Routes through the extension status surface: extensions may replace the
 * settled/interrupted fold presentation with their own.
 */
export function TurnFoldRow({ row, sessionId, extensions, onToggleTurnFold }: TurnFoldRowProps) {
  const expandedTurnKeys = useTurnFoldStore(selectExpandedTurnKeys(sessionId))
  const expanded = expandedTurnKeys.has(row.turnKey)

  return (
    <ExtensionAgentLoopSurface
      fallback={<CoreFoldRow row={row} expanded={expanded} onToggleTurnFold={onToggleTurnFold} />}
      input={{
        surface: 'status',
        status: {
          label: row.label,
          tone: row.interrupted ? 'warning' : 'success',
        },
      }}
      projectPaths={extensions.projectPaths}
      registry={extensions.registry}
    />
  )
}
