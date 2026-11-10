// Doc screenshots are full window captures shown at the width of the text column. Each Markdown
// image becomes a link to the image file, so it opens at full size with or without JavaScript;
// DocsImageLightbox.astro enhances the link into an in-page dialog.

// Only the fields this plugin reads. `@types/hast` is not a website dependency, so it is not imported.
interface HastNode {
  type: string
  tagName?: string
  value?: string
  properties?: Record<string, unknown>
  children?: HastNode[]
}

export const ZOOMABLE_IMAGE_CLASS = 'docs-image-link'

// Only a site-root or absolute address is final here. Astro's image pipeline rewrites a relative
// Markdown image (`./shot.png`) after rehype runs, so a link to its source path would 404.
const FINAL_IMAGE_ADDRESS = /^(?:\/|https?:\/\/)/u

function zoomLink(image: HastNode, href: string): HastNode {
  return {
    type: 'element',
    tagName: 'a',
    properties: { href, className: [ZOOMABLE_IMAGE_CLASS] },
    children: [
      image,
      {
        type: 'element',
        tagName: 'span',
        properties: { className: ['docs-visually-hidden'] },
        children: [{ type: 'text', value: ' (open full size)' }],
      },
    ],
  }
}

function visit(node: HastNode) {
  // An image that is already a link keeps its own destination.
  if (node.type === 'element' && node.tagName === 'a') return
  const children = node.children
  if (!children) return
  for (const [index, child] of children.entries()) {
    const src = child.properties?.src
    if (
      child.type === 'element' &&
      child.tagName === 'img' &&
      typeof src === 'string' &&
      FINAL_IMAGE_ADDRESS.test(src)
    ) {
      children[index] = zoomLink(child, src)
    } else {
      visit(child)
    }
  }
}

/**
 * Rehype plugin: wraps every Markdown image with a site-root or absolute address that is not
 * already a link in a link to the image. Run it before rehype-external-links, so a link to an
 * external image gets the same `rel` and `target` as other external links.
 */
export function rehypeZoomableImages() {
  return (tree: HastNode) => visit(tree)
}
