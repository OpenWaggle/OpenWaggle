import type { SessionId } from '@shared/types/brand'
import type { UIMessage } from '@shared/types/chat-ui'
import { Check, Copy, FileDown, FileText, GitBranch, GitFork, Image, Waypoints } from 'lucide-react'
import { Children, cloneElement, isValidElement, type ReactNode } from 'react'
import type { Components } from 'react-markdown'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { ATTACHMENT_TEXT_PREFIX } from '@/features/chat/lib/useAgentChat.utils'
import { SessionMessageImages } from '@/features/session-summary'
import { useCopyToClipboard } from '@/shared/hooks/useCopyToClipboard'
import { cn } from '@/shared/lib/cn'
import { safeMarkdownRehypePlugins, safeMarkdownUrlTransform } from '@/shared/lib/markdown-safety'
import { createSyntaxMarkdownComponents } from '@/shared/lib/syntax/markdown-components'
import { Button } from '@/shared/ui/Button'
import { useChatDisplayTextFormatter } from './ChatDisplayPathContext'
import { renderTextWithMentions } from './MentionText'

const USER_REMARK_PLUGINS = [remarkGfm]

/**
 * Recursively walks ReactNode children, replacing string nodes with
 * composer-reference-chip-enriched fragments. Skips recursion into <a> and
 * <code> elements to avoid chipifying link text or code content.
 *
 * Uses Children.map/cloneElement because ReactMarkdown children are opaque
 * ReactNode trees. If React deprecates these APIs, migrate
 * to a custom remark plugin instead.
 */
function processChildrenForComposerReferences(children: ReactNode): ReactNode {
  return Children.map(children, (child) => {
    if (typeof child === 'string') {
      const parts = renderTextWithMentions(child)
      return parts.length > 0 ? parts : child
    }

    if (isValidElement<{ children?: ReactNode }>(child) && child.props.children !== undefined) {
      // Don't recurse into links or code — @mentions there should stay plain
      if (typeof child.type === 'string' && (child.type === 'a' || child.type === 'code')) {
        return child
      }
      return cloneElement(child, {}, processChildrenForComposerReferences(child.props.children))
    }

    return child
  })
}

function UserMarkdownParagraph({ children }: { readonly children?: ReactNode }) {
  return <p>{processChildrenForComposerReferences(children)}</p>
}

function UserMarkdownListItem({ children }: { readonly children?: ReactNode }) {
  return <li>{processChildrenForComposerReferences(children)}</li>
}

const userMarkdownComponents: Components = createSyntaxMarkdownComponents({
  p: UserMarkdownParagraph,
  li: UserMarkdownListItem,
})

function isAttachmentText(content: string) {
  return content.startsWith(ATTACHMENT_TEXT_PREFIX)
}

function parseAttachmentName(content: string) {
  const afterPrefix = content.slice(ATTACHMENT_TEXT_PREFIX.length)
  // Name is the first line after the prefix
  const newlineIndex = afterPrefix.indexOf('\n')
  return newlineIndex >= 0 ? afterPrefix.slice(0, newlineIndex) : afterPrefix
}

function getAttachmentIcon(name: string) {
  const lower = name.toLowerCase()
  if (
    lower.endsWith('.png') ||
    lower.endsWith('.jpg') ||
    lower.endsWith('.jpeg') ||
    lower.endsWith('.gif') ||
    lower.endsWith('.webp') ||
    lower.endsWith('.svg')
  ) {
    return Image
  }
  if (lower.endsWith('.pdf')) {
    return FileDown
  }
  return FileText
}

function AttachmentIcon({ name }: { readonly name: string }) {
  const icon = getAttachmentIcon(name)
  if (icon === Image) {
    return <Image className="size-3.5 shrink-0 text-text-tertiary" />
  }
  if (icon === FileDown) {
    return <FileDown className="size-3.5 shrink-0 text-text-tertiary" />
  }
  return <FileText className="size-3.5 shrink-0 text-text-tertiary" />
}

function AttachmentChip({ name }: { readonly name: string }) {
  return (
    <div
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md border border-border',
        'bg-bg-tertiary px-2 py-1 text-xs text-text-secondary',
      )}
    >
      <AttachmentIcon name={name} />
      <span className="truncate max-w-50">{name}</span>
    </div>
  )
}

function WaggleInvocationChip({ message }: { readonly message: UIMessage }) {
  const invocation = message.metadata?.waggleInvocation
  if (!invocation) return null

  return (
    <span className="mt-px inline-flex shrink-0 items-center gap-1.5 rounded-md border border-accent/30 bg-accent/10 px-2 py-1 text-xs text-accent">
      <Waypoints className="size-3.5" />
      <span>{invocation.presetName}</span>
      {invocation.source === 'agent' ? (
        <span className="text-xs uppercase tracking-wide text-accent/60">agent</span>
      ) : null}
    </span>
  )
}

function UserMessageContent({
  message,
  contentParts,
}: {
  readonly message: UIMessage
  readonly contentParts: readonly Extract<UIMessage['parts'][number], { type: 'text' }>[]
}) {
  const formatDisplayText = useChatDisplayTextFormatter()
  if (contentParts.length === 0) return null
  return (
    <div className="prose prose-user min-w-0 flex-1 max-w-none break-words [overflow-wrap:anywhere]">
      {contentParts.map((part) => (
        <ReactMarkdown
          key={`${message.id}-text-${part.content}`}
          remarkPlugins={USER_REMARK_PLUGINS}
          rehypePlugins={safeMarkdownRehypePlugins}
          urlTransform={safeMarkdownUrlTransform}
          components={userMarkdownComponents}
        >
          {formatDisplayText(part.content)}
        </ReactMarkdown>
      ))}
    </div>
  )
}

interface UserMessageBubbleProps {
  message: UIMessage
  sessionId?: SessionId | null
  onBranchFromMessage?: (messageId: string) => void
  onForkFromMessage?: (messageId: string) => void
}

export function UserMessageBubble({
  message,
  sessionId = null,
  onBranchFromMessage,
  onForkFromMessage,
}: UserMessageBubbleProps) {
  const { copied, copy } = useCopyToClipboard()

  const textParts = message.parts.filter(
    (p): p is Extract<(typeof message.parts)[number], { type: 'text' }> => p.type === 'text',
  )
  const contentParts = textParts.filter((p) => !isAttachmentText(p.content))
  const attachmentParts = textParts.filter((p) => isAttachmentText(p.content))

  function handleCopy() {
    copy(contentParts.map((p) => p.content).join('\n'))
  }

  return (
    <div className="group/user-msg flex justify-end w-full">
      <div
        className={cn(
          'relative min-w-0 max-w-full rounded-2xl rounded-br-xs',
          'border border-border-light bg-bg-hover px-3.5 py-2.5',
        )}
      >
        <SessionMessageImages
          sessionId={sessionId}
          messageId={message.metadata?.sessionNodeId ?? message.id}
        />
        {attachmentParts.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5 first:mt-0">
            {attachmentParts.map((p, i) => (
              <AttachmentChip
                key={`${message.id}-attachment-${String(i)}`}
                name={parseAttachmentName(p.content)}
              />
            ))}
          </div>
        )}
        {message.metadata?.waggleInvocation ? (
          <div className="flex min-w-0 items-start gap-2" data-waggle-invocation-line="true">
            <WaggleInvocationChip message={message} />
            <UserMessageContent message={message} contentParts={contentParts} />
          </div>
        ) : (
          <UserMessageContent message={message} contentParts={contentParts} />
        )}
        <div className="absolute -bottom-7 right-0 flex items-center gap-2 opacity-0 group-hover/user-msg:opacity-100 transition-opacity">
          {onBranchFromMessage ? (
            <Button
              variant="unstyled"
              type="button"
              title="Branch from message"
              onClick={() => onBranchFromMessage(message.id)}
              className="flex items-center gap-1 text-xs text-text-muted hover:text-text-secondary cursor-pointer"
            >
              <GitBranch className="size-3" />
            </Button>
          ) : null}

          {onForkFromMessage ? (
            <Button
              variant="unstyled"
              type="button"
              title="Fork to new session"
              onClick={() => onForkFromMessage(message.id)}
              className="flex cursor-pointer items-center gap-1 text-xs text-text-muted hover:text-text-secondary"
            >
              <GitFork className="size-3" />
            </Button>
          ) : null}

          <Button
            variant="unstyled"
            type="button"
            title="Copy message"
            onClick={handleCopy}
            className="flex items-center gap-1 text-xs text-text-muted hover:text-text-secondary cursor-pointer"
          >
            {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
          </Button>
        </div>
      </div>
    </div>
  )
}
