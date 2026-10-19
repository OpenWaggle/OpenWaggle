import type { UIMessage } from '@shared/types/chat-ui'
import { Check, Copy, GitBranch, GitFork } from 'lucide-react'
import type { ReactNode } from 'react'
import { useCopyToClipboard } from '@/shared/hooks/useCopyToClipboard'
import { cn } from '@/shared/lib/cn'
import { Button } from '@/shared/ui/Button'

interface TurnReplyActionHandlers {
  readonly onBranchFromMessage?: (messageId: string) => void
  readonly onForkFromResponse?: (messageId: string) => void
}

interface TurnReplyActionsProps {
  readonly message: UIMessage
  readonly actions: TurnReplyActionHandlers
  /** The latest reply keeps its actions in view; earlier ones show them on hover. */
  readonly latest: boolean
  /**
   * While the Session runs it takes no branch or copy, so only Copy response stays; the bar keeps
   * its place, so sending does not move the reply above the new turn.
   */
  readonly running: boolean
}

/** The text a reply shows, as Copy copies it: its text parts, without tool calls or thinking. */
function replyText(message: UIMessage) {
  return message.parts
    .flatMap((part) => (part.type === 'text' && part.content.trim() ? [part.content] : []))
    .join('\n\n')
}

function ActionButton({
  label,
  onClick,
  children,
}: {
  readonly label: string
  readonly onClick: () => void
  readonly children: ReactNode
}) {
  return (
    <Button
      variant="unstyled"
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className="flex cursor-pointer items-center rounded p-0.5 text-text-muted transition-colors hover:text-text-secondary"
    >
      {children}
    </Button>
  )
}

/**
 * The actions of a settled turn's reply, at the end of the whole turn: after its folded work, its
 * text, and its changed-files card, which opens the turn's diff (ADR 0055). Continue, Fork, and
 * Copy mirror a user message's Edit, Fork, and Copy.
 */
export function TurnReplyActions({ message, actions, latest, running }: TurnReplyActionsProps) {
  const { copied, copy } = useCopyToClipboard()
  const text = replyText(message)
  const onBranchFromMessage = running ? undefined : actions.onBranchFromMessage
  const onForkFromResponse = running ? undefined : actions.onForkFromResponse
  return (
    <div
      data-turn-reply-actions={message.id}
      className={cn(
        // Pulled up to the turn it closes, out of the transcript's row gap.
        '-mt-4 flex items-center gap-1.5 transition-opacity',
        !latest && 'opacity-0 group-hover/turn-reply:opacity-100 focus-within:opacity-100',
      )}
    >
      {onBranchFromMessage ? (
        <ActionButton label="Continue from here" onClick={() => onBranchFromMessage(message.id)}>
          <GitBranch className="size-3.5" />
        </ActionButton>
      ) : null}
      {onForkFromResponse ? (
        <ActionButton
          label="Fork from this response"
          onClick={() => onForkFromResponse(message.id)}
        >
          <GitFork className="size-3.5" />
        </ActionButton>
      ) : null}
      {text ? (
        <ActionButton label="Copy response" onClick={() => copy(text)}>
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
        </ActionButton>
      ) : null}
    </div>
  )
}
