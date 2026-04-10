import type { Root } from 'hast'
import { toJsxRuntime } from 'hast-util-to-jsx-runtime'
import type { ReactNode } from 'react'
import { Fragment, jsx, jsxs } from 'react/jsx-runtime'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Highlighter } from 'shiki'
import { useIncrementalMarkdown } from '@/hooks/useIncrementalMarkdown'
import {
  type RehypePlugins,
  safeMarkdownComponents,
  safeMarkdownUrlTransform,
} from '@/lib/markdown-safety'
import { isReactElementWithProps } from '@/lib/react-element-guard'
import type { ShikiCache } from '@/lib/shiki/shiki-cache'
import { CodeBlock } from './CodeBlock'

interface IncrementalMarkdownProps {
  text: string
  isStreaming: boolean
  highlighter: Highlighter | undefined
  cache: ShikiCache
  rehypePlugins: RehypePlugins
  /** Lightweight plugins for the streaming tail (e.g. sanitize-only, no Shiki). */
  tailRehypePlugins?: RehypePlugins
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

/** Shared component overrides for both prefix and tail rendering. */
const markdownComponents = {
  ...safeMarkdownComponents,
  pre({ children }: { children?: ReactNode }) {
    const language = extractLanguage(children)
    return <CodeBlock language={language}>{children}</CodeBlock>
  },
  code({ className, children, ...props }: { className?: string; children?: ReactNode }) {
    return (
      <code className={className} {...props}>
        {children}
      </code>
    )
  },
}

function PrefixView({ prefixHast }: { prefixHast: Root }) {
  const element = toJsxRuntime(prefixHast, {
    Fragment,
    jsx,
    jsxs,
    components: markdownComponents,
  })

  return <>{element}</>
}

export function IncrementalMarkdown({
  text,
  isStreaming,
  highlighter,
  cache,
  rehypePlugins,
  tailRehypePlugins,
}: IncrementalMarkdownProps) {
  const { prefixHast, tail } = useIncrementalMarkdown(text, isStreaming, {
    highlighter,
    cache,
  })

  if (prefixHast !== null && isStreaming) {
    return (
      <>
        <PrefixView prefixHast={prefixHast} />
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={tailRehypePlugins ?? rehypePlugins}
          urlTransform={safeMarkdownUrlTransform}
          components={markdownComponents}
        >
          {tail}
        </ReactMarkdown>
      </>
    )
  }

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={rehypePlugins}
      urlTransform={safeMarkdownUrlTransform}
      components={markdownComponents}
    >
      {text}
    </ReactMarkdown>
  )
}
