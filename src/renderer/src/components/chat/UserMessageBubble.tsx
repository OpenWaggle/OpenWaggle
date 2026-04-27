import type { UIMessage } from '@shared/types/chat-ui'
import { Check, Copy, FileDown, FileText, GitBranch, Image } from 'lucide-react'
import { Children, cloneElement, isValidElement, type ReactNode } from 'react'
import type { Components } from 'react-markdown'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { ATTACHMENT_TEXT_PREFIX } from '@/hooks/useAgentChat.utils'
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard'
import { cn } from '@/lib/cn'
import {
  safeMarkdownComponents,
  safeMarkdownRehypePlugins,
  safeMarkdownUrlTransform,
} from '@/lib/markdown-safety'
import { renderTextWithMentions } from './MentionText'

const USER_REMARK_PLUGINS = [remarkGfm]

/**
 * Recursively walks ReactNode children, replacing string nodes with
 * mention-chip-enriched fragments. Skips recursion into <a> and <code>
 * elements to avoid chipifying link text or code content.
 *
 * Uses Children.map/cloneElement because ReactMarkdown children are opaque
 * ReactNode trees. If React deprecates these APIs, migrate
 * to a custom remark plugin instead.
 */
function processChildrenForMentions(children: ReactNode): ReactNode {
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
      return cloneElement(child, {}, processChildrenForMentions(child.props.children))
    }

    return child
  })
}

function UserMarkdownParagraph({ children }: { readonly children?: ReactNode }) {
  return <p>{processChildrenForMentions(children)}</p>
}

function UserMarkdownListItem({ children }: { readonly children?: ReactNode }) {
  return <li>{processChildrenForMentions(children)}</li>
}

const userMarkdownComponents: Components = {
  ...safeMarkdownComponents,
  p: UserMarkdownParagraph,
  li: UserMarkdownListItem,
}

function isAttachmentText(content: string): boolean {
  return content.startsWith(ATTACHMENT_TEXT_PREFIX)
}

function parseAttachmentName(content: string): string {
  const afterPrefix = content.slice(ATTACHMENT_TEXT_PREFIX.length)
  // Name is the first line after the prefix
  const newlineIndex = afterPrefix.indexOf('\n')
  return newlineIndex >= 0 ? afterPrefix.slice(0, newlineIndex) : afterPrefix
}

function getAttachmentIcon(name: string): typeof FileText {
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
    return <Image className="h-3.5 w-3.5 shrink-0 text-text-tertiary" />
  }
  if (icon === FileDown) {
    return <FileDown className="h-3.5 w-3.5 shrink-0 text-text-tertiary" />
  }
  return <FileText className="h-3.5 w-3.5 shrink-0 text-text-tertiary" />
}

function AttachmentChip({ name }: { readonly name: string }) {
  return (
    <div
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md border border-border',
        'bg-bg-tertiary px-2 py-1 text-[12px] text-text-secondary',
      )}
    >
      <AttachmentIcon name={name} />
      <span className="truncate max-w-[200px]">{name}</span>
    </div>
  )
}

interface UserMessageBubbleProps {
  message: UIMessage
  onBranchFromMessage?: (messageId: string) => void
}

export function UserMessageBubble({ message, onBranchFromMessage }: UserMessageBubbleProps) {
  const { copied, copy } = useCopyToClipboard()

  const textParts = message.parts.filter(
    (p): p is Extract<(typeof message.parts)[number], { type: 'text' }> => p.type === 'text',
  )
  const contentParts = textParts.filter((p) => !isAttachmentText(p.content))
  const attachmentParts = textParts.filter((p) => isAttachmentText(p.content))

  function handleCopy(): void {
    copy(contentParts.map((p) => p.content).join('\n'))
  }

  return (
    <div className="group/user-msg flex justify-end w-full">
      <div className="relative rounded-[16px_16px_2px_16px] bg-bg-hover border border-border-light py-2.5 px-3.5">
        {attachmentParts.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-2">
            {attachmentParts.map((p, i) => (
              <AttachmentChip
                key={`${message.id}-attachment-${String(i)}`}
                name={parseAttachmentName(p.content)}
              />
            ))}
          </div>
        )}
        {contentParts.length > 0 && (
          <div className="prose prose-user max-w-none">
            {contentParts.map((p, i) => (
              <ReactMarkdown
                key={`${message.id}-text-${String(i)}`}
                remarkPlugins={USER_REMARK_PLUGINS}
                rehypePlugins={safeMarkdownRehypePlugins}
                urlTransform={safeMarkdownUrlTransform}
                components={userMarkdownComponents}
              >
                {p.content}
              </ReactMarkdown>
            ))}
          </div>
        )}
        <div className="absolute -bottom-7 right-0 flex items-center gap-2 opacity-0 group-hover/user-msg:opacity-100 transition-all">
          {onBranchFromMessage ? (
            <button
              type="button"
              title="Branch from message"
              onClick={() => onBranchFromMessage(message.id)}
              className="flex items-center gap-1 text-[12px] text-text-muted hover:text-text-secondary cursor-pointer"
            >
              <GitBranch className="h-3 w-3" />
            </button>
          ) : null}

          <button
            type="button"
            title="Copy message"
            onClick={handleCopy}
            className="flex items-center gap-1 text-[12px] text-text-muted hover:text-text-secondary cursor-pointer"
          >
            {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          </button>
        </div>
      </div>
    </div>
  )
}
