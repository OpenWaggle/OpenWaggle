import { renderMermaidSVG } from 'beautiful-mermaid';

// Mermaid blocks are rendered to SVG while the site builds, so a diagram page ships no diagram
// JavaScript, needs no browser in CI, and shows the diagram with JavaScript off. beautiful-mermaid
// lays diagrams out in pure JavaScript (ELK); it supports flowcharts, state, sequence, class and ER
// diagrams. A block it cannot parse fails the build with the page path.

// The site's dark theme (global.css). The SVG reads these through its own --bg/--fg variables.
const DIAGRAM_COLORS = {
  bg: 'var(--color-bg-secondary)',
  fg: 'var(--color-text-primary)',
  line: 'var(--color-text-tertiary)',
  accent: 'var(--color-accent)',
  muted: 'var(--color-text-tertiary)',
  surface: 'var(--color-bg-tertiary)',
  border: 'var(--color-border-light)',
} as const;

// beautiful-mermaid starts every SVG with the same <style> block: a Google Fonts @import, which the
// CSP blocks and the site does not need (it self-hosts Inter), and unscoped `text`/`svg` rules that
// would apply to every SVG on the page. prose.css carries the same rules scoped to the diagram.
const STYLE_BLOCK = /<style>[\s\S]*?<\/style>/u;
const ID_ATTRIBUTE = /\sid="([^"]+)"/gu;
const MIN_SCALE = 0.7;

/** Escapes text for an HTML text node or a double-quoted attribute. */
function escapeHtml(text: string) {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

/** Prefixes the SVG's ids (arrowhead markers) so several diagrams on one page do not share ids. */
function prefixIds(svg: string, prefix: string) {
  const ids = new Set([...svg.matchAll(ID_ATTRIBUTE)].map(([, id = '']) => id));
  let result = svg;
  for (const id of ids) {
    result = result
      .replaceAll(` id="${id}"`, ` id="${prefix}-${id}"`)
      .replaceAll(`url(#${id})`, `url(#${prefix}-${id})`)
      .replaceAll(`href="#${id}"`, `href="#${prefix}-${id}"`);
  }
  return result;
}

/**
 * Renders Mermaid source to the HTML of a diagram figure: the SVG, then the source text in a
 * collapsed disclosure so it can be read or copied.
 */
export function renderMermaidFigure(source: string, idPrefix: string): string {
  const rendered = renderMermaidSVG(source.trim(), { ...DIAGRAM_COLORS, transparent: true });
  // The SVG shrinks to the text column, but no further than a readable scale; a wider diagram
  // scrolls inside its figure instead.
  const width = Number(/<svg [^>]*\bwidth="([\d.]+)"/u.exec(rendered)?.[1] ?? 0);
  const minWidth = Math.round(width * MIN_SCALE);
  const svg = prefixIds(rendered.replace(STYLE_BLOCK, ''), idPrefix)
    .replace('<svg ', '<svg class="mermaid-svg" ')
    .replace(/(<svg [^>]*\bstyle=")/u, `$1min-width:${minWidth}px;`);
  if (/<style|url\(\s*['"]?https?:/iu.test(svg)) {
    throw new Error('The rendered SVG carries its own styles or remote resources, which the site does not allow.');
  }
  return [
    '<figure class="mermaid-diagram">',
    svg,
    '<details class="mermaid-source">',
    '<summary>Diagram source</summary>',
    `<pre>${escapeHtml(source.trim())}</pre>`,
    '</details>',
    '</figure>',
  ].join('\n');
}

// Only the fields this plugin reads. `@types/mdast` is not a website dependency, so it is not imported.
interface MdastNode {
  type: string;
  lang?: string | null;
  value?: string;
  children?: MdastNode[];
}

interface MarkdownFile {
  path?: string;
}

/**
 * Remark plugin: replaces each ```mermaid code block with a rendered diagram. It runs before
 * Shiki, so the block never becomes a highlighted code block.
 */
export function remarkMermaidDiagrams() {
  return (tree: MdastNode, file: MarkdownFile) => {
    let count = 0;
    const visit = (node: MdastNode) => {
      const children = node.children;
      if (!children) return;
      for (const [index, child] of children.entries()) {
        if (child.type === 'code' && child.lang === 'mermaid') {
          count += 1;
          try {
            children[index] = { type: 'html', value: renderMermaidFigure(child.value ?? '', `mermaid-${count}`) };
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            throw new Error(`Mermaid diagram ${count} in ${file.path ?? 'a Markdown file'} failed to render: ${message}`, {
              cause: error,
            });
          }
        } else {
          visit(child);
        }
      }
    };
    visit(tree);
  };
}
