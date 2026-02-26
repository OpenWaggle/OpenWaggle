import type { ComponentPropsWithoutRef } from 'react'
import type { Components, Options as ReactMarkdownOptions, UrlTransform } from 'react-markdown'
import rehypeHighlight from 'rehype-highlight'
import rehypeSanitize, { defaultSchema, type Options as SanitizeSchema } from 'rehype-sanitize'

type RehypePlugins = NonNullable<ReactMarkdownOptions['rehypePlugins']>
type AttributeDefinition = NonNullable<NonNullable<SanitizeSchema['attributes']>[string]>[number]

const ALLOWED_LINK_PROTOCOLS = new Set(['http:', 'https:', 'mailto:', 'tel:'])
const PROTOCOL_PATTERN = /^[a-zA-Z][a-zA-Z\d+.-]*:/

const highlightClassDefinition: AttributeDefinition = [
  'className',
  /^language-[\w-]+$/,
  /^hljs(?:-[\w-]+)?$/,
]
const anchorTargetDefinition: AttributeDefinition = ['target', '_blank']
const anchorRelDefinition: AttributeDefinition = ['rel', 'noopener', 'noreferrer', 'nofollow']
const ALLOWED_HREF_PROTOCOLS = ['http', 'https', 'mailto', 'tel']

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
    code: [...schemaAttributesForTag('code'), highlightClassDefinition],
    pre: [...schemaAttributesForTag('pre'), highlightClassDefinition],
    span: [...schemaAttributesForTag('span'), highlightClassDefinition],
  },
}

export const safeMarkdownRehypePlugins: RehypePlugins = [
  rehypeHighlight,
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
