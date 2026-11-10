import type { SessionBranchId } from '@shared/types/brand'
import type { ExtensionContributionRegistryView } from '@shared/types/extensions'
import type { TurnCheckpointSummary } from '@shared/types/turn-diff'
import type { MessageBubbleRuntime } from './MessageBubble'

export interface ChatRowRenderContext {
  readonly runtime: MessageBubbleRuntime
  readonly extensions: {
    readonly registry: ExtensionContributionRegistryView | null
    readonly projectPaths: readonly string[]
  }
  /** Turn checkpoints keyed by their anchored terminal assistant message id (ADR 0034). */
  readonly turnsByAnchorNodeId: ReadonlyMap<string, TurnCheckpointSummary>
  readonly actions: {
    readonly onDismissInterruptedRun?:
      | ((runId: string, branchId: SessionBranchId) => void)
      | undefined
    readonly onBranchFromMessage?: ((messageId: string) => void) | undefined
    readonly onForkFromMessage?: ((messageId: string) => void) | undefined
    readonly onForkFromResponse?: ((messageId: string) => void) | undefined
    /**
     * The Host holds the Session (a Run, until it settles, or a compaction): no branch or copy is
     * offered.
     */
    readonly copiesBlocked?: boolean | undefined
    readonly onViewTurnDiff?: ((messageId: string) => void) | undefined
    readonly onOpenTurnDiff?: ((messageId: string, filePath?: string) => void) | undefined
    readonly turnAnchorMessageIds?: ReadonlySet<string> | undefined
    readonly onToggleTurnFold?: ((turnKey: string) => void) | undefined
  }
  readonly onOpenSettings?: (() => void) | undefined
  readonly onRetry?: ((content: string) => void) | undefined
  readonly onDismissError: (message: string) => void
}
