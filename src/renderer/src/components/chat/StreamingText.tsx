import type { ReactElement, ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import rehypeHighlight from 'rehype-highlight'
import remarkGfm from 'remark-gfm'
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
  if (!Array.isArray(children) && typeof children === 'object' && children !== null) {
    const el = children as ReactElement<{ className?: string }>
    const className = el.props?.className
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
        rehypePlugins={[rehypeHighlight]}
        components={{
          pre({ children }) {
            const language = extractLanguage(children)
            return <CodeBlock language={language}>{children}</CodeBlock>
          },
          code({ className, children, ...props }) {
            // Inline code only — block code is handled by the pre override above
            // which preserves rehype-highlight's token spans
            const isBlock = className?.startsWith('language-')
            if (isBlock) {
              return (
                <code className={className} {...props}>
                  {children}
                </code>
              )
            }
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
