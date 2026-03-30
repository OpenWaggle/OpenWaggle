import type { UIMessage } from '@tanstack/ai-react'
import { Check, Copy } from 'lucide-react'
import { Children, cloneElement, isValidElement, type ReactNode } from 'react'
import type { Components } from 'react-markdown'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard'
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
 * Uses Children.map/cloneElement (legacy React APIs) because ReactMarkdown
 * children are opaque ReactNode trees. If React deprecates these, migrate
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

const userMarkdownComponents: Components = {
  ...safeMarkdownComponents,
  p({ children }) {
    return <p>{processChildrenForMentions(children)}</p>
  },
  li({ children }) {
    return <li>{processChildrenForMentions(children)}</li>
  },
}

interface UserMessageBubbleProps {
  message: UIMessage
}

export function UserMessageBubble({ message }: UserMessageBubbleProps) {
  const { copied, copy } = useCopyToClipboard()

  const textParts = message.parts.filter(
    (p): p is Extract<(typeof message.parts)[number], { type: 'text' }> => p.type === 'text',
  )

  function handleCopy(): void {
    copy(textParts.map((p) => p.content).join('\n'))
  }

  return (
    <div className="group/user-msg flex justify-end w-full">
      <div className="relative rounded-[16px_16px_2px_16px] bg-bg-hover border border-border-light py-2.5 px-3.5">
        <div className="prose prose-user max-w-none">
          {textParts.map((p, i) => (
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
        <button
          type="button"
          onClick={handleCopy}
          className="absolute -bottom-7 right-0 flex items-center gap-1 text-[12px] text-text-muted hover:text-text-secondary transition-all opacity-0 group-hover/user-msg:opacity-100 cursor-pointer"
        >
          {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
        </button>
      </div>
    </div>
  )
}
