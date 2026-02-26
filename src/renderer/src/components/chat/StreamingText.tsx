import type { ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  safeMarkdownComponents,
  safeMarkdownRehypePlugins,
  safeMarkdownUrlTransform,
} from '@/lib/markdown-safety'
import { isReactElementWithProps } from '@/lib/react-element-guard'
import { CodeBlock } from './CodeBlock'

interface StreamingTextProps {
  text: string
  /** When true, renders plain text instead of parsing markdown — avoids re-parsing on every token. */
  isStreaming?: boolean
}

/**
 * Extract language from a <code className="language-xxx"> child inside a <pre>.
 */
function extractLanguage(children: ReactNode): string | undefined {
  if (isReactElementWithProps<{ className?: string }>(children)) {
    const className = children.props?.className
    if (typeof className === 'string') {
      const match = /language-(\w+)/.exec(className)
      if (match) return match[1]
    }
  }
  return undefined
}

export function StreamingText({ text, isStreaming }: StreamingTextProps): React.JSX.Element | null {
  if (!text) return null

  if (isStreaming) {
    return <div className="prose whitespace-pre-wrap">{text}</div>
  }

  return (
    <div className="prose">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={safeMarkdownRehypePlugins}
        urlTransform={safeMarkdownUrlTransform}
        components={{
          ...safeMarkdownComponents,
          pre({ children }) {
            const language = extractLanguage(children)
            return <CodeBlock language={language}>{children}</CodeBlock>
          },
          code({ className, children, ...props }) {
            return (
              <code className={className} {...props}>
                {children}
              </code>
            )
          },
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
}
