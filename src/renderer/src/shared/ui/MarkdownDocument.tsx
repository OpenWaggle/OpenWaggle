import { useMemo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { cn } from '@/shared/lib/cn'
import { safeMarkdownRehypePlugins, safeMarkdownUrlTransform } from '@/shared/lib/markdown-safety'
import { createSyntaxMarkdownComponents } from '@/shared/lib/syntax/markdown-components'

export function MarkdownDocument({
  children,
  className,
  theme,
}: {
  readonly children: string
  readonly className?: string
  readonly theme?: string
}) {
  const components = useMemo(() => createSyntaxMarkdownComponents({}, { theme }), [theme])
  return (
    <div className={cn('prose prose-invert text-sm text-text-secondary', className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={safeMarkdownRehypePlugins}
        urlTransform={safeMarkdownUrlTransform}
        components={components}
      >
        {children}
      </ReactMarkdown>
    </div>
  )
}
