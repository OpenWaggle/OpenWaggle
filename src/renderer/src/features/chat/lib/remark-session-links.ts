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
 * a pasted `openwaggle://sessions/<id>` would otherwise stay text. The match may end in one slash
 * but must not continue as a longer URL (`…/items`, `?query`), which is not a Session link.
 */
const SESSION_LINK_TEXT =
  /(?<![\w.+-])openwaggle:\/\/sessions\/[A-Za-z0-9][A-Za-z0-9_-]*\/?(?![\w/?#:@-])/gi

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

function linkSessionLinks(node: MarkdownNode) {
  if (!node.children || LINKED_PARENTS.has(node.type)) return
  node.children = node.children.flatMap((child) => {
    if (child.type === 'text' && typeof child.value === 'string') return splitText(child.value)
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
