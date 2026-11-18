import type { ExtensionContributionRegistryView } from '@shared/types/extensions'
import { ChevronDown, ChevronRight } from 'lucide-react'
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

/** The quiet row standing in for one settled turn's work (ADR 0034). */
export function TurnFoldRow({ row, sessionId, extensions, onToggleTurnFold }: TurnFoldRowProps) {
  const expandedTurnKeys = useTurnFoldStore(selectExpandedTurnKeys(sessionId))
  const expanded = expandedTurnKeys.has(row.turnKey)
  const Chevron = expanded ? ChevronDown : ChevronRight

  return (
    <div className="flex items-center gap-1 border-b border-border pb-2 pt-1 text-sm text-text-tertiary">
      <ExtensionAgentLoopSurface
        fallback={<span className="px-1 leading-relaxed tabular-nums">{row.label}</span>}
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
      <Button
        variant="unstyled"
        type="button"
        onClick={() => onToggleTurnFold(row.turnKey)}
        aria-expanded={expanded}
        aria-label={expanded ? 'Collapse turn details' : 'Expand turn details'}
        data-testid="turn-fold-row"
        className="flex cursor-pointer items-center rounded-md p-1 transition-colors hover:text-text-primary"
      >
        <Chevron className="size-3.5" />
      </Button>
    </div>
  )
}
