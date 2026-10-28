import type { Processor } from 'unified'

/**
 * Bounded re-parse of a streaming list (B9, ADR 0026).
 *
 * A list with no blank line between its items is one Markdown block, so while it streams the whole
 * list was the live tail and was parsed again on every token: forty items of an answer meant
 * parsing forty items forty times each. Only the last item still changes. This remark plugin parses
 * the items before it once and caches the tree, parses the last item alone, and joins the two into
 * the tree the whole list parses to, positions included, so everything after the parser (and what
 * renders) is unchanged.
 *
 * It applies only where items cannot affect each other: one marker style, one space after each
 * marker, no blank lines, fences, lazy continuation lines, thematic breaks, reference or footnote
 * definitions, and every continuation line indented past its item's marker. Anything else is
 * parsed whole, as before.
 */

/** The mdast this plugin reads and writes; remark's node types are not a direct dependency. */
interface MarkdownPoint {
  line: number
  column: number
  offset?: number
}

interface MarkdownNode {
  type: string
  position?: { start: MarkdownPoint; end: MarkdownPoint }
  children?: MarkdownNode[]
  ordered?: boolean | null
  spread?: boolean | null
  [field: string]: unknown
}

export interface ListTailSplit {
  /** The items before the last, ending with a line ending. */
  readonly head: string
  /** The last item, still streaming. */
  readonly last: string
}

const MARKER_LINE = /^(?:(?<bullet>[-+*])|\d{1,9}(?<delimiter>[.)])) (?=\S|$)/u
const THEMATIC_BREAK = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/u
const FENCE_LINE = /^[ \t]*(?:`{3,}|~{3,})/u
const REFERENCE_OR_FOOTNOTE = /\[[^\]\n]*\]:|\[\^/u
const MAX_CACHED_HEADS = 8
/** A head needs one finished item and the last item another. */
const MIN_SPLIT_ITEMS = 2

/** The item marker a line starts with: its style, and how far its content is indented. */
function itemMarker(line: string) {
  const match = MARKER_LINE.exec(line)
  if (!match || THEMATIC_BREAK.test(line)) return null
  return {
    style: match.groups?.bullet ?? match.groups?.delimiter ?? null,
    contentIndent: match[0].length,
  }
}

/** Whether a line that starts no item continues the item before it, indented under its content. */
function continuesItem(line: string, isStreamingEnd: boolean, contentIndent: number) {
  // A line still streaming at the end may be anything so far.
  if (isStreamingEnd && line.length === 0) return true
  if (line.trim().length === 0) return false
  return line.length - line.trimStart().length >= contentIndent
}

/** Where the last item starts, when the text is a list whose items cannot affect each other. */
export function splitListTail(text: string): ListTailSplit | null {
  if (REFERENCE_OR_FOOTNOTE.test(text)) return null
  let marker: string | null = null
  let contentIndent = 0
  let lastItemOffset = -1
  let items = 0
  let offset = 0
  for (const line of text.split('\n')) {
    const lineOffset = offset
    offset += line.length + 1
    if (FENCE_LINE.test(line)) return null
    const item = itemMarker(line)
    if (item) {
      if (marker !== null && item.style !== marker) return null
      marker = item.style
      contentIndent = item.contentIndent
      lastItemOffset = lineOffset
      items += 1
      continue
    }
    // The first line is an item.
    if (items === 0) return null
    if (!continuesItem(line, lineOffset + line.length === text.length, contentIndent)) return null
  }
  if (items < MIN_SPLIT_ITEMS) return null
  return { head: text.slice(0, lastItemOffset), last: text.slice(lastItemOffset) }
}

function isNode(value: unknown): value is MarkdownNode {
  return (
    typeof value === 'object' && value !== null && typeof Reflect.get(value, 'type') === 'string'
  )
}

function onlyList(tree: MarkdownNode) {
  const children = tree.children ?? []
  const list = children[0]
  return children.length === 1 && list?.type === 'list' && list.spread !== true ? list : null
}

function shiftPoint(point: MarkdownPoint, lines: number, characters: number) {
  point.line += lines
  if (point.offset !== undefined) point.offset += characters
}

function shiftPositions(node: MarkdownNode, lines: number, characters: number) {
  if (node.position) {
    shiftPoint(node.position.start, lines, characters)
    shiftPoint(node.position.end, lines, characters)
  }
  for (const child of node.children ?? []) shiftPositions(child, lines, characters)
}

/**
 * The tree of the whole list from the trees of its head and its last item, or `null` when the
 * two do not form one list (another list type, a loose list, anything besides one list).
 */
export function joinListTrees(head: MarkdownNode, last: MarkdownNode, headText: string) {
  const headList = onlyList(head)
  const lastList = onlyList(last)
  if (!headList || !lastList || headList.ordered !== lastList.ordered) return null
  const lines = headText.split('\n').length - 1
  shiftPositions(last, lines, headText.length)
  const lastItems = lastList.children ?? []
  const joinedList: MarkdownNode = {
    ...headList,
    children: [...(headList.children ?? []), ...lastItems],
    ...(headList.position && lastList.position
      ? { position: { start: headList.position.start, end: lastList.position.end } }
      : {}),
  }
  return {
    ...head,
    children: [joinedList],
    ...(head.position && last.position
      ? { position: { start: head.position.start, end: last.position.end } }
      : {}),
  }
}

const headTrees = new Map<string, MarkdownNode>()

function cachedHeadTree(head: string, parse: (document: string) => unknown) {
  let tree = headTrees.get(head)
  if (tree) {
    headTrees.delete(head)
  } else {
    const parsed = parse(head)
    if (!isNode(parsed)) return null
    tree = parsed
    if (headTrees.size >= MAX_CACHED_HEADS) {
      const oldest = headTrees.keys().next()
      if (!oldest.done) headTrees.delete(oldest.value)
    }
  }
  headTrees.set(head, tree)
  // Shared, not copied: copying it cost a third of the parse it saves, and nothing after the
  // parser writes to the Markdown tree (remark-rehype builds a new HTML tree from it). The join
  // builds new list and root nodes around the shared items, and shifts only the last item's.
  return tree
}

/** Remark plugin for a streaming tail: the parser above, falling back to a whole parse. */
export function remarkStreamingListTail(this: Processor) {
  const parse = this.parser
  if (!parse) return
  this.parser = (document, file) => {
    const split = splitListTail(document)
    if (!split) return parse(document, file)
    const head = cachedHeadTree(split.head, (text) => parse(text, file))
    const last = parse(split.last, file)
    const joined = head && isNode(last) ? joinListTrees(head, last, split.head) : null
    return joined ?? parse(document, file)
  }
}
