// A wide Markdown table scrolls inside its own box instead of squeezing its columns until words
// break mid-word. prose.css styles the wrapper and keeps words whole inside table cells.

// Only the fields this plugin reads. `@types/hast` is not a website dependency, so it is not imported.
interface HastNode {
  type: string
  tagName?: string
  value?: string
  properties?: Record<string, unknown>
  children?: HastNode[]
}

export const SCROLLABLE_TABLE_CLASS = 'docs-table-scroll'

const HEADING_TAGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6'])

function textOf(node: HastNode): string {
  if (node.type === 'text') return node.value ?? ''
  return (node.children ?? []).map(textOf).join('')
}

// Each table region is named after the heading above it, so a screen reader's landmark list tells
// the tables apart ("Exit codes table", "Exit codes table 2").
interface LabelState {
  heading: string
  countUnderHeading: number
}

function nextLabel(state: LabelState) {
  state.countUnderHeading += 1
  const base = state.heading === '' ? 'Table' : `${state.heading} table`
  return state.countUnderHeading === 1 ? base : `${base} ${state.countUnderHeading}`
}

function isHeading(node: HastNode) {
  return node.type === 'element' && node.tagName !== undefined && HEADING_TAGS.has(node.tagName)
}

function visit(node: HastNode, state: LabelState) {
  const children = node.children
  if (!children) return
  for (const [index, child] of children.entries()) {
    if (isHeading(child)) {
      state.heading = textOf(child).trim()
      state.countUnderHeading = 0
      continue
    }
    if (child.type !== 'element' || child.tagName !== 'table') {
      visit(child, state)
      continue
    }
    children[index] = {
      type: 'element',
      tagName: 'div',
      // Focusable so keyboard users can scroll a wide table (axe: scrollable-region-focusable).
      properties: {
        className: [SCROLLABLE_TABLE_CLASS],
        tabIndex: 0,
        role: 'region',
        ariaLabel: nextLabel(state),
      },
      children: [child],
    }
  }
}

/** Rehype plugin: wraps every table in a horizontally scrollable, labelled `div.docs-table-scroll`. */
export function rehypeScrollableTables() {
  return (tree: HastNode) => visit(tree, { heading: '', countUnderHeading: 0 })
}
