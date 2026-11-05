// A wide Markdown table scrolls inside its own box instead of squeezing its columns until words
// break mid-word. prose.css styles the wrapper and keeps words whole inside table cells.

// Only the fields this plugin reads. `@types/hast` is not a website dependency, so it is not imported.
interface HastNode {
  type: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
}

export const SCROLLABLE_TABLE_CLASS = 'docs-table-scroll';

function visit(node: HastNode) {
  const children = node.children;
  if (!children) return;
  for (const [index, child] of children.entries()) {
    if (child.type === 'element' && child.tagName === 'table') {
      children[index] = {
        type: 'element',
        tagName: 'div',
        properties: { className: [SCROLLABLE_TABLE_CLASS] },
        children: [child],
      };
    } else {
      visit(child);
    }
  }
}

/** Rehype plugin: wraps every table in a horizontally scrollable `div.docs-table-scroll`. */
export function rehypeScrollableTables() {
  return (tree: HastNode) => visit(tree);
}
