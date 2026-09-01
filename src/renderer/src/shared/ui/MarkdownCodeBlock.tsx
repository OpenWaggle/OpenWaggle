import { Check, Copy } from 'lucide-react'
import type { ReactNode } from 'react'
import { useState } from 'react'
import { cn } from '@/shared/lib/cn'
import { api } from '@/shared/lib/ipc'
import { isReactElementWithProps } from '@/shared/lib/react-element-guard'
import { Button } from './Button'
import { PlainTextBlock } from './PlainTextBlock'
import { SyntaxBlock } from './SyntaxBlock'

const COPY_FEEDBACK_MS = 2_000

function textContent(node: ReactNode): string {
  if (typeof node === 'string') return node
  if (typeof node === 'number') return String(node)
  if (!node) return ''
  if (Array.isArray(node)) return node.map(textContent).join('')
  if (isReactElementWithProps<{ children?: ReactNode }>(node)) {
    return textContent(node.props.children)
  }
  return ''
}

export function MarkdownCodeBlock({
  children,
  language,
  className,
  highlight = true,
  theme,
}: {
  readonly children: ReactNode
  readonly language?: string
  readonly className?: string
  readonly highlight?: boolean
  readonly theme?: string
}) {
  const [copied, setCopied] = useState(false)
  const source = textContent(children).replace(/\n$/, '')

  function handleCopy() {
    api.copyToClipboard(source)
    setCopied(true)
    window.setTimeout(() => setCopied(false), COPY_FEEDBACK_MS)
  }

  return (
    <div
      className={cn(
        'markdown-code-block group relative rounded-lg border border-border bg-bg-secondary/60',
        className,
      )}
    >
      <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
        <span className="font-mono text-xs text-text-muted">{language ?? 'text'}</span>
        <Button
          variant="unstyled"
          type="button"
          onClick={handleCopy}
          className="flex items-center gap-1 text-sm text-text-muted transition-colors hover:text-text-secondary"
        >
          {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
      {highlight ? (
        <SyntaxBlock
          key="complete"
          source={source}
          language={language ?? 'text'}
          theme={theme}
          ariaLabel={`${language ?? 'Plain text'} source`}
          className="bg-transparent text-sm leading-relaxed"
        />
      ) : (
        <PlainTextBlock
          reason="performance"
          ariaLabel={`${language ?? 'Plain text'} streaming source`}
          className="syntax-typography rounded-none bg-transparent p-3 text-sm leading-relaxed"
        >
          {source}
        </PlainTextBlock>
      )}
    </div>
  )
}
