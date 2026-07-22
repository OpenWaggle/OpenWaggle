import type { SessionBranchId } from '@shared/types/brand'
import type { ExtensionContributionRegistryView } from '@shared/types/extensions'
import type { MessageBubbleRuntime } from './MessageBubble'

export interface ChatRowRenderContext {
  readonly runtime: MessageBubbleRuntime
  readonly extensions: {
    readonly registry: ExtensionContributionRegistryView | null
    readonly projectPaths: readonly string[]
  }
  readonly actions: {
    readonly onBranchFromMessage?: (messageId: string) => void
    readonly onForkFromMessage?: (messageId: string) => void
  }
  readonly onOpenSettings?: () => void
  readonly onRetry?: (content: string) => void
  readonly onDismissError: (message: string) => void
  readonly onDismissInterruptedRun?: (runId: string, branchId: SessionBranchId) => void
}
