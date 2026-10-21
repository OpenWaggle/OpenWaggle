import { parseSessionLink, sessionLink } from '@shared/utils/session-link'

/** The mdast shape this plugin reads; remark's own node types are not a direct dependency. */
interface MarkdownNode {
  type: string
  value?: string
  url?: string
  children?: MarkdownNode[]
}

/**
 * A Session link written as plain text. GFM only links `http(s)`, `www.`, and email literals, so
 * a pasted `openwaggle://sessions/<id>` would otherwise stay text. The link may end in one slash
 * and must end where prose does: at whitespace, the end, any character outside ASCII (CJK `，`,
 * curly quotes, dashes), a closing bracket or quote, or punctuation such as `?`, `?!` or `.`
 * that ends a sentence. A longer URL (`…/items`, `…?prompt=`, `….html`) is not a Session link
 * and stays text.
 */
const SESSION_LINK_TEXT =
  /(?<![\w.+-])openwaggle:\/\/sessions\/[A-Za-z0-9][A-Za-z0-9_-]*\/?(?=$|[^\x21-\x7e]|[)\],;'">*~]|[.:?!]+(?:$|[^\x21-\x7e]|[)\]'"]))/gi

/** Nodes whose text is already a link or a link label. Code is a separate node type. */
const LINKED_PARENTS = new Set(['link', 'linkReference', 'definition'])

function splitText(value: string): MarkdownNode[] {
  const nodes: MarkdownNode[] = []
  let start = 0
  for (const match of value.matchAll(SESSION_LINK_TEXT)) {
    const written = match[0]
    const sessionId = parseSessionLink(written)
    // The canonical link, so a link written in capitals still passes the sanitizer's scheme check.
    const url = sessionId === null ? null : sessionLink(sessionId)
    if (url === null) continue
    if (match.index > start) nodes.push({ type: 'text', value: value.slice(start, match.index) })
    nodes.push({ type: 'link', url, children: [{ type: 'text', value: written }] })
    start = match.index + written.length
  }
  if (start === 0) return [{ type: 'text', value }]
  if (start < value.length) nodes.push({ type: 'text', value: value.slice(start) })
  return nodes
}

/** Agents often write a link as inline code; code that is exactly a Session link links too. */
function linkedInlineCode(node: MarkdownNode): MarkdownNode {
  const sessionId = typeof node.value === 'string' ? parseSessionLink(node.value) : null
  const url = sessionId === null ? null : sessionLink(sessionId)
  return url === null ? node : { type: 'link', url, children: [node] }
}

function linkSessionLinks(node: MarkdownNode) {
  if (!node.children || LINKED_PARENTS.has(node.type)) return
  node.children = node.children.flatMap((child) => {
    if (child.type === 'text' && typeof child.value === 'string') return splitText(child.value)
    if (child.type === 'inlineCode') return [linkedInlineCode(child)]
    linkSessionLinks(child)
    return [child]
  })
}

/**
 * Remark plugin that makes Session links written as plain text clickable (ADR 0056). Streaming
 * text skips it until its block is complete, so a half-written identity is never a live link.
 */
export function remarkSessionLinks() {
  return (tree: MarkdownNode) => {
    linkSessionLinks(tree)
  }
}
