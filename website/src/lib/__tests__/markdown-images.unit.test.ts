import { readFileSync } from 'node:fs'
import { unified } from '@astrojs/markdown-remark'
import rehypeExternalLinks from 'rehype-external-links'
import { describe, expect, it } from 'vitest'
import { rehypeZoomableImages } from '../markdown-images'

async function render(markdown: string) {
  // The order astro.config.ts uses: the image links go through rehype-external-links.
  const processor = await unified({
    rehypePlugins: [
      rehypeZoomableImages,
      [rehypeExternalLinks, { target: '_blank', rel: ['noopener', 'noreferrer'] }],
    ],
  }).createRenderer({ syntaxHighlight: 'shiki' })
  return (await processor.render(markdown)).code
}

describe('zoomable doc images', () => {
  it('links each image to its full-size file with an accessible name', async () => {
    const html = await render('![The Hive panel with two Workers](/screenshots/hive-sessions.png)')
    expect(html).toBe(
      '<p><a href="/screenshots/hive-sessions.png" class="docs-image-link">' +
        '<img src="/screenshots/hive-sessions.png" alt="The Hive panel with two Workers">' +
        '<span class="docs-visually-hidden"> (open full size)</span></a></p>',
    )
  })

  it('leaves an image that is already a link alone', async () => {
    const html = await render('[![Logo](/logo.png)](https://openwaggle.ai/)')
    expect(html).toBe(
      '<p><a href="https://openwaggle.ai/" rel="noopener noreferrer" target="_blank"><img src="/logo.png" alt="Logo"></a></p>',
    )
  })

  it('gives a link to an external image the attributes of other external links', async () => {
    const html = await render('![A diagram](https://example.com/diagram.png)')
    expect(html).toContain(
      '<a href="https://example.com/diagram.png" class="docs-image-link" rel="noopener noreferrer" target="_blank">',
    )
  })

  it.each(['./shot.png', '../images/shot.png', 'shot.png', 'data:image/png;base64,AAAA'])(
    'leaves an image whose address the build rewrites or inlines alone: %s',
    async (src) => {
      const html = await render(`![Shot](${src})`)
      expect(html).not.toContain('docs-image-link')
    },
  )

  it('stays wired into the Astro Markdown pipeline, before the link plugins', () => {
    const config = readFileSync(new URL('../../../astro.config.ts', import.meta.url), 'utf8')
    expect(config).toMatch(
      /rehypePlugins: \[\s*(?:\/\/[^\n]*\n\s*)*rehypeZoomableImages,\s*\[rehypeExternalLinks\b/u,
    )
  })
})
