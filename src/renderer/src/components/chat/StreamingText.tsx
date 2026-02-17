import ReactMarkdown from 'react-markdown'
import rehypeHighlight from 'rehype-highlight'
import remarkGfm from 'remark-gfm'
import { CodeBlock } from './CodeBlock'

interface StreamingTextProps {
  text: string
  /** When true, renders plain text instead of parsing markdown — avoids re-parsing on every token. */
  isStreaming?: boolean
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
          code({ className, children, ...props }) {
            const match = /language-(\w+)/.exec(className || '')
            const isBlock = String(children).includes('\n')

            if (isBlock || match) {
              return <CodeBlock code={String(children).replace(/\n$/, '')} language={match?.[1]} />
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
