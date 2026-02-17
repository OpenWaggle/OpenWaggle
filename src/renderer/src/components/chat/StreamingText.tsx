import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { CodeBlock } from './CodeBlock'

interface StreamingTextProps {
  text: string
}

export function StreamingText({ text }: StreamingTextProps): React.JSX.Element | null {
  if (!text) return null

  return (
    <div className="prose">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
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
