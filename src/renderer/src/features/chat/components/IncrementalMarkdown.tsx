import type { Root } from 'hast'
import { toJsxRuntime } from 'hast-util-to-jsx-runtime'
import type { ReactNode } from 'react'
import { Fragment, jsx, jsxs } from 'react/jsx-runtime'
import type { Components } from 'react-markdown'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Highlighter } from 'shiki'
import { useIncrementalMarkdown } from '@/features/chat/hooks/useIncrementalMarkdown'
import { SafeMarkdownLink } from '@/shared/lib/markdown-link-components'
import { type RehypePlugins, safeMarkdownUrlTransform } from '@/shared/lib/markdown-safety'
import { isReactElementWithProps } from '@/shared/lib/react-element-guard'
import type { ShikiCache } from '@/shared/lib/shiki/shiki-cache'
import { CodeBlock } from './CodeBlock'

const REMARK_PLUGINS = [remarkGfm]

interface IncrementalMarkdownProps {
  text: string
  isStreaming: boolean
  highlighter: Highlighter | undefined
  cache: ShikiCache
  rehypePlugins: RehypePlugins
  /** Lightweight plugins for the streaming tail (e.g. sanitize-only, no Shiki). */
  tailRehypePlugins?: RehypePlugins | undefined
}

/**
 * Extract language from a <code className="language-xxx"> child inside a <pre>.
 */
function extractLanguage(children: ReactNode) {
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
const markdownComponents: Components = {
  a: SafeMarkdownLink,
  pre({ children }: { children?: ReactNode }) {
    const language = extractLanguage(children)
    return <CodeBlock language={language}>{children}</CodeBlock>
  },
  code({
    className,
    children,
    ...props
  }: {
    className?: string | undefined
    children?: ReactNode | undefined
  }) {
    return (
      <code className={className} {...props}>
        {children}
      </code>
    )
  },
}

function PrefixView({ prefixHast }: { prefixHast: Root }) {
  return (
    <>
      {toJsxRuntime(prefixHast, {
        Fragment,
        jsx,
        jsxs,
        components: markdownComponents,
      })}
    </>
  )
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
          remarkPlugins={REMARK_PLUGINS}
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
      remarkPlugins={REMARK_PLUGINS}
      rehypePlugins={rehypePlugins}
      urlTransform={safeMarkdownUrlTransform}
      components={markdownComponents}
    >
      {text}
    </ReactMarkdown>
  )
}
