import type { ComponentPropsWithoutRef } from 'react'
import type { Components, Options as ReactMarkdownOptions, UrlTransform } from 'react-markdown'
import rehypeSanitize, { defaultSchema, type Options as SanitizeSchema } from 'rehype-sanitize'

export type RehypePlugins = NonNullable<ReactMarkdownOptions['rehypePlugins']>
type AttributeDefinition = NonNullable<NonNullable<SanitizeSchema['attributes']>[string]>[number]

const ALLOWED_LINK_PROTOCOLS = new Set(['http:', 'https:', 'mailto:', 'tel:'])
const PROTOCOL_PATTERN = /^[a-zA-Z][a-zA-Z\d+.-]*:/

/** Shiki uses language-* classes on code elements and line/shiki classes on spans/pre. */
const shikiClassDefinition: AttributeDefinition = [
  'className',
  /^language-[\w-]+$/,
  'line',
  /^shiki(?:-[\w-]+)?$/,
]
const anchorTargetDefinition: AttributeDefinition = ['target', '_blank']
const anchorRelDefinition: AttributeDefinition = ['rel', 'noopener', 'noreferrer', 'nofollow']
const ALLOWED_HREF_PROTOCOLS = ['http', 'https', 'mailto', 'tel']

/** Shiki uses inline `style` attributes for syntax token colors. */
const styleAttributeDefinition: AttributeDefinition = 'style'

function schemaAttributesForTag(tagName: string): AttributeDefinition[] {
  const tagAttributes = defaultSchema.attributes?.[tagName]
  return tagAttributes ? [...tagAttributes] : []
}

function extractProtocol(rawUrl: string): string | null {
  const trimmedUrl = rawUrl.trim()
  if (!trimmedUrl) return null

  const match = PROTOCOL_PATTERN.exec(trimmedUrl)
  if (!match) return null

  return match[0].toLowerCase()
}

export function isAllowedMarkdownUrl(rawUrl: string): boolean {
  const protocol = extractProtocol(rawUrl)
  if (!protocol) return false
  return ALLOWED_LINK_PROTOCOLS.has(protocol)
}

export const safeMarkdownUrlTransform: UrlTransform = (url) => {
  const trimmedUrl = url.trim()
  if (!isAllowedMarkdownUrl(trimmedUrl)) return undefined
  return trimmedUrl
}

export const safeMarkdownSanitizeSchema: SanitizeSchema = {
  ...defaultSchema,
  protocols: {
    ...(defaultSchema.protocols ?? {}),
    href: ALLOWED_HREF_PROTOCOLS,
  },
  attributes: {
    ...(defaultSchema.attributes ?? {}),
    a: [...schemaAttributesForTag('a'), anchorTargetDefinition, anchorRelDefinition],
    code: [...schemaAttributesForTag('code'), shikiClassDefinition, styleAttributeDefinition],
    pre: [...schemaAttributesForTag('pre'), shikiClassDefinition, styleAttributeDefinition],
    span: [...schemaAttributesForTag('span'), shikiClassDefinition, styleAttributeDefinition],
  },
}

/**
 * Default rehype plugins for non-streaming markdown (e.g. SkillsPanel).
 * Sanitize-only — Shiki highlighting is wired separately in StreamingText.
 */
export const safeMarkdownRehypePlugins: RehypePlugins = [
  [rehypeSanitize, safeMarkdownSanitizeSchema],
]

function SafeMarkdownLink({ href, children }: ComponentPropsWithoutRef<'a'>): React.JSX.Element {
  if (!href || !isAllowedMarkdownUrl(href)) {
    return <span>{children}</span>
  }

  return (
    <a href={href} target="_blank" rel="noopener noreferrer nofollow">
      {children}
    </a>
  )
}

export const safeMarkdownComponents: Components = {
  a: SafeMarkdownLink,
}
