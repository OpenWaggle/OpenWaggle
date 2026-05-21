import { Check, Copy } from 'lucide-react'
import type { ReactNode } from 'react'
import { useState } from 'react'
import { cn } from '@/shared/lib/cn'
import { api } from '@/shared/lib/ipc'
import { isReactElementWithProps } from '@/shared/lib/react-element-guard'
import { Button } from '@/shared/ui/Button'

const DELAY_MS = 2000

interface CodeBlockProps {
  children: ReactNode
  language?: string | undefined
  className?: string | undefined
}

/**
 * Recursively extract text content from React nodes for the copy button.
 */
function getTextContent(node: ReactNode): string {
  if (typeof node === 'string') return node
  if (typeof node === 'number') return String(node)
  if (!node) return ''
  if (Array.isArray(node)) return node.map(getTextContent).join('')
  if (isReactElementWithProps<{ children?: ReactNode }>(node)) {
    return getTextContent(node.props.children)
  }
  return ''
}

export function CodeBlock({ children, language, className }: CodeBlockProps) {
  const [copied, setCopied] = useState(false)

  function handleCopy() {
    const text = getTextContent(children).replace(/\n$/, '')
    api.copyToClipboard(text)
    setCopied(true)
    setTimeout(() => setCopied(false), DELAY_MS)
  }

  return (
    <div
      className={cn('group relative rounded-lg border border-border bg-bg-secondary/60', className)}
    >
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border">
        <span className="text-[12px] text-text-muted font-mono">{language ?? 'text'}</span>
        <Button
          variant="unstyled"
          type="button"
          onClick={handleCopy}
          className="flex items-center gap-1 text-[13px] text-text-muted hover:text-text-secondary transition-colors"
        >
          {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
      <pre className="overflow-x-auto p-3 [&>code]:text-[14px] [&>code]:leading-relaxed [&>code]:font-mono">
        {children}
      </pre>
    </div>
  )
}
