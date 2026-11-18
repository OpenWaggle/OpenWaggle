import type { SessionId } from '@shared/types/brand'
import type { UIMessage } from '@shared/types/chat-ui'
import type { ExtensionContributionRegistryView } from '@shared/types/extensions'
import type { SupportedModelId } from '@shared/types/llm'
import { AssistantMessageBubble, type WaggleInfo } from './AssistantMessageBubble'
import { HiveWakeNotice } from './HiveWakeNotice'
import { UserMessageBubble } from './UserMessageBubble'

export interface MessageBubbleRuntime {
  readonly sessionId: SessionId | null
  readonly extensions: {
    readonly registry: ExtensionContributionRegistryView | null
    readonly projectPaths: readonly string[]
  }
}

interface MessageBubbleProps {
  message: UIMessage
  runtime: MessageBubbleRuntime
  waggle?: WaggleInfo
  run?: {
    readonly isStreaming?: boolean
    readonly isRunActive?: boolean
    readonly assistantModel?: SupportedModelId
  }
  presentation?: {
    readonly hideAgentLabel?: boolean
    /** Terminal message of a folded turn: render only its final text part. */
    readonly turnFolded?: boolean
    /** The settled turn's reply, whose actions sit at the end of its turn. */
    readonly replyActions?: boolean
  }
  actions?: {
    readonly onBranchFromMessage?: (messageId: string) => void
    readonly onForkFromMessage?: (messageId: string) => void
    readonly copiesBlocked?: boolean
    readonly onViewTurnDiff?: (messageId: string) => void
    readonly turnAnchorMessageIds?: ReadonlySet<string>
  }
}

/** A user row: the user's own message, or the Host's Hive wake notice, which takes no actions. */
function UserMessageRow({
  message,
  actions,
}: {
  readonly message: UIMessage
  readonly actions: MessageBubbleProps['actions'] | undefined
}) {
  if (message.metadata?.hiveWake) return <HiveWakeNotice message={message} />
  return (
    <UserMessageBubble
      message={message}
      {...(actions?.onBranchFromMessage === undefined
        ? {}
        : { onBranchFromMessage: actions?.onBranchFromMessage })}
      {...(actions?.onForkFromMessage === undefined
        ? {}
        : { onForkFromMessage: actions?.onForkFromMessage })}
    />
  )
}

export function MessageBubble({
  message,
  runtime,
  waggle,
  run,
  presentation,
  actions,
}: MessageBubbleProps) {
  // Edit and fork points are a user message and a settled turn's reply (ADR 0055); a reply's sit at
  // the end of its turn (`TurnReplyActions`). A running Session takes none of them, since the Host
  // refuses a copy or a branch while it runs.
  const idle = run?.isRunActive !== true && actions?.copiesBlocked !== true
  if (message.role === 'user') {
    return <UserMessageRow message={message} actions={idle ? actions : undefined} />
  }
  // A reply's turn diff opens from the changed-files card at the end of its turn.
  const headerTurnDiff =
    !presentation?.replyActions &&
    actions?.onViewTurnDiff &&
    actions.turnAnchorMessageIds?.has(message.id)
      ? { onViewTurnDiff: actions.onViewTurnDiff }
      : {}

  return (
    <AssistantMessageBubble
      message={message}
      runtime={runtime}
      {...(run === undefined ? {} : { run })}
      {...(waggle === undefined ? {} : { waggle })}
      {...(presentation === undefined ? {} : { presentation })}
      actions={headerTurnDiff}
    />
  )
}
