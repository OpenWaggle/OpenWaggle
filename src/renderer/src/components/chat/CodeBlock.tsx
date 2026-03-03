import { Check, Copy } from 'lucide-react'
import type { ReactNode } from 'react'
import { useState } from 'react'
import { cn } from '@/lib/cn'
import { api } from '@/lib/ipc'
import { isReactElementWithProps } from '@/lib/react-element-guard'

interface CodeBlockProps {
  children: ReactNode
  language?: string
  className?: string
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

export function CodeBlock({ children, language, className }: CodeBlockProps): React.JSX.Element {
  const [copied, setCopied] = useState(false)

  function handleCopy(): void {
    const text = getTextContent(children).replace(/\n$/, '')
    api.copyToClipboard(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div
      className={cn('group relative rounded-lg border border-border bg-bg-secondary/60', className)}
    >
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border">
        <span className="text-[12px] text-text-muted font-mono">{language ?? 'text'}</span>
        <button
          type="button"
          onClick={handleCopy}
          className="flex items-center gap-1 text-[13px] text-text-muted hover:text-text-secondary transition-colors"
        >
          {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="overflow-x-auto p-3 [&>code]:text-[14px] [&>code]:leading-relaxed [&>code]:font-mono">
        {children}
      </pre>
    </div>
  )
}
