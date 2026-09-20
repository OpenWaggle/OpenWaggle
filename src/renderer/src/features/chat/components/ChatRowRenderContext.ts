import type { ExtensionContributionRegistryView } from '@shared/types/extensions'
import type { TurnCheckpointSummary } from '@shared/types/turn-diff'
import type { MessageBubbleRuntime } from './MessageBubble'

export interface ChatRowRenderContext {
  readonly runtime: MessageBubbleRuntime
  readonly extensions: {
    readonly registry: ExtensionContributionRegistryView | null
    readonly projectPaths: readonly string[]
  }
  /** Turn checkpoints keyed by their anchored terminal assistant message id (ADR 0033). */
  readonly turnsByAnchorNodeId: ReadonlyMap<string, TurnCheckpointSummary>
  readonly actions: {
    readonly onBranchFromMessage?: (messageId: string) => void
    readonly onForkFromMessage?: (messageId: string) => void
    readonly onViewTurnDiff?: (messageId: string) => void
    readonly onOpenTurnDiff?: (messageId: string, filePath?: string) => void
    readonly turnAnchorMessageIds?: ReadonlySet<string>
    readonly onToggleTurnFold?: (turnKey: string) => void
  }
  readonly onOpenSettings?: () => void
  readonly onRetry?: (content: string) => void
  readonly onDismissError: (message: string) => void
}
