import type { Root } from 'hast'
import { toJsxRuntime } from 'hast-util-to-jsx-runtime'
import type { ReactNode } from 'react'
import { Fragment, jsx, jsxs } from 'react/jsx-runtime'
import type { Components } from 'react-markdown'
import ReactMarkdown from 'react-markdown'
import rehypeSanitize from 'rehype-sanitize'
import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import remarkRehype from 'remark-rehype'
import { unified } from 'unified'
import { remarkSessionLinks } from '@/features/chat/lib/remark-session-links'
import { remarkStreamingListTail } from '@/features/chat/lib/streaming-list-tail'
import {
  completedMarkdownBlocks,
  type StreamingMarkdownTail,
  splitStreamingMarkdown,
} from '@/features/chat/lib/streaming-markdown-blocks'
import { withReferenceDefinitions } from '@/features/chat/lib/streaming-markdown-definitions'
import { NonFetchingMarkdownImage, SafeMarkdownLink } from '@/shared/lib/markdown-link-components'
import {
  type RehypePlugins,
  safeMarkdownSanitizeSchema,
  safeMarkdownUrlTransform,
} from '@/shared/lib/markdown-safety'
import { fencedCodeLanguage } from '@/shared/lib/syntax/markdown-components'
import { useChatDisplayMarkdown, useChatDisplayMarkdownFormatter } from './ChatDisplayPathContext'
import { CodeBlock } from './CodeBlock'

/** Markdown → sanitized HAST for completed blocks, with the same plugins as settled text. */
const blockProcessor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkSessionLinks)
  .use(remarkRehype)
  .use(rehypeSanitize, safeMarkdownSanitizeSchema)

const REMARK_PLUGINS = [remarkGfm, remarkSessionLinks]
/**
 * A streaming block may hold half a Session link; it is linked once the block completes. The
 * live tail parses a streaming list's finished items once (`remarkStreamingListTail`).
 */
const LIVE_TAIL_REMARK_PLUGINS = [remarkGfm, remarkStreamingListTail]

interface IncrementalMarkdownProps {
  text: string
  isStreaming: boolean
  rehypePlugins: RehypePlugins
  /** Lightweight plugins for the streaming tail (e.g. sanitize-only, no Shiki). */
  tailRehypePlugins?: RehypePlugins | undefined
}

/**
 * Extract language from a <code className="language-xxx"> child inside a <pre>.
 */
/** Shared component overrides for both prefix and tail rendering. */
const markdownComponents: Components = {
  a: SafeMarkdownLink,
  img: NonFetchingMarkdownImage,
  pre({ children }: { children?: ReactNode }) {
    const language = fencedCodeLanguage(children)
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

const streamingTailMarkdownComponents: Components = {
  ...markdownComponents,
  pre({ children }: { children?: ReactNode }) {
    const language = fencedCodeLanguage(children)
    return (
      <CodeBlock language={language} highlight={false}>
        {children}
      </CodeBlock>
    )
  },
}

/** Parses one completed block to sanitized HAST. */
function parseBlock(markdown: string) {
  return blockProcessor.runSync(blockProcessor.parse(markdown))
}

/** A safe `language-*` class from a fence's info string, as Markdown renders it. */
const FENCE_LANGUAGE_PATTERN = /^[\w#+.-]+$/u

/**
 * An open fence as Markdown renders it, built without parsing: a `pre` holding a `code` whose
 * text is the fenced lines, without their last line ending, plus the one Markdown adds.
 */
function openFenceHast(language: string | null, code: string): Root {
  const value = code.replace(/\r?\n$/u, '')
  const className =
    language && FENCE_LANGUAGE_PATTERN.test(language) ? [`language-${language}`] : []
  return {
    type: 'root',
    children: [
      {
        type: 'element',
        tagName: 'pre',
        properties: {},
        children: [
          {
            type: 'element',
            tagName: 'code',
            properties: className.length > 0 ? { className } : {},
            children: value ? [{ type: 'text', value: `${value}\n` }] : [],
          },
        ],
      },
    ],
  }
}

/**
 * A completed block: parsed and rendered once. Its text never changes while the answer streams,
 * so the compiler keeps its tree, and a token re-renders none of the blocks before it (ADR 0026).
 * Display paths are shortened per block, so they are not rewritten across the answer per token.
 * The answer's reference definitions the block uses are parsed with it.
 */
function StreamingMarkdownBlock({
  text,
  definitions,
}: {
  readonly text: string
  readonly definitions: string
}) {
  const markdown = useChatDisplayMarkdown(withReferenceDefinitions(text, definitions))
  return (
    <>
      {toJsxRuntime(parseBlock(markdown), {
        Fragment,
        jsx,
        jsxs,
        components: markdownComponents,
      })}
    </>
  )
}

/** A fence still open at the end of the stream: its lines, unparsed and unhighlighted. */
function OpenFenceTail({
  language,
  code,
}: {
  readonly language: string | null
  readonly code: string
}) {
  return (
    <>
      {toJsxRuntime(openFenceHast(language, code), {
        Fragment,
        jsx,
        jsxs,
        components: streamingTailMarkdownComponents,
      })}
    </>
  )
}

function LiveTail({
  tail,
  definitions,
  rehypePlugins,
}: {
  readonly tail: StreamingMarkdownTail
  readonly definitions: string
  readonly rehypePlugins: RehypePlugins
}) {
  const formatDisplayMarkdown = useChatDisplayMarkdownFormatter()
  if (tail.kind === 'open-fence') return <OpenFenceTail language={tail.language} code={tail.code} />
  return (
    <ReactMarkdown
      remarkPlugins={LIVE_TAIL_REMARK_PLUGINS}
      rehypePlugins={rehypePlugins}
      urlTransform={safeMarkdownUrlTransform}
      components={streamingTailMarkdownComponents}
    >
      {formatDisplayMarkdown(withReferenceDefinitions(tail.text, definitions))}
    </ReactMarkdown>
  )
}

/**
 * The completed blocks, from the text before the live tail. That text (and the definitions) only
 * changes when a block (or a definition line) completes, so a token re-renders none of them: the
 * element is the same while the prefix is. Mapped inline, every block's component ran again on
 * each token.
 */
function CompletedBlocks({
  prefix,
  definitions,
}: {
  readonly prefix: string
  readonly definitions: string
}) {
  return completedMarkdownBlocks(prefix).map((block) => (
    <StreamingMarkdownBlock key={block.start} text={block.text} definitions={definitions} />
  ))
}

/**
 * Markdown that may still be streaming (B9). While it streams, completed blocks render once each
 * and only the tail is parsed per token; a fence still open is not parsed at all. Settled text
 * renders as one document.
 */
export function IncrementalMarkdown({
  text,
  isStreaming,
  rehypePlugins,
  tailRehypePlugins,
}: IncrementalMarkdownProps) {
  const formatDisplayMarkdown = useChatDisplayMarkdownFormatter()

  if (!isStreaming) {
    return (
      <ReactMarkdown
        remarkPlugins={REMARK_PLUGINS}
        rehypePlugins={rehypePlugins}
        urlTransform={safeMarkdownUrlTransform}
        components={markdownComponents}
      >
        {formatDisplayMarkdown(text)}
      </ReactMarkdown>
    )
  }

  const { tail, definitions } = splitStreamingMarkdown(text)
  return (
    <>
      <CompletedBlocks prefix={tail ? text.slice(0, tail.start) : text} definitions={definitions} />
      {tail ? (
        <LiveTail
          key={`tail-${String(tail.start)}`}
          tail={tail}
          definitions={definitions}
          rehypePlugins={tailRehypePlugins ?? rehypePlugins}
        />
      ) : null}
    </>
  )
}
