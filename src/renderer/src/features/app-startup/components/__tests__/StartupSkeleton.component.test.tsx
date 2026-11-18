import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import indexHtml from '../../../../../index.html?raw'
import { StartupSkeleton } from '../StartupSkeleton'

/** The markup the page paints before its scripts run, in its `#startup-frame` cover. */
function pageStartupFrame() {
  const match = /<div id="startup-frame"[^>]*>([\s\S]*?<\/main>)<\/div>/u.exec(indexHtml)
  if (!match?.[1]) throw new Error('index.html has no startup frame')
  return match[1]
}

/** Asset URLs differ by build step (source path, hash, data URL); the asset they name does not. */
function comparable(markup: string) {
  return (
    markup
      // React hoists a preload for each image it renders; the page needs none.
      .replaceAll(/<link rel="preload" as="image"[^>]*\/>/gu, '')
      .replaceAll(/src="data:image\/png;base64,[^"]*"/gu, 'src="inlined-png"')
      .replaceAll(/src="[^"]*\.png\?inline"/gu, 'src="inlined-png"')
      .replaceAll(/src="[^"]*?(openwaggle-[a-z]+)[^"]*"/gu, 'src="$1"')
      .replaceAll(/>\s+</gu, '><')
      // React adds the font warm-up after the first paint; the page leaves it out (see the component).
      .replace(/<div aria-hidden="true" data-startup-font-warmup=""[\s\S]*?<\/div>/u, '')
      .trim()
  )
}

/*
 * index.html holds the startup frame so the window paints it before the renderer's scripts run
 * (W11: first paint and the largest contentful paint). React then renders StartupSkeleton in its
 * place; any difference between the two would show as a jump in the first second.
 */
describe('startup frame', () => {
  it('is the same markup in index.html as StartupSkeleton renders', () => {
    expect(comparable(pageStartupFrame())).toBe(
      comparable(renderToStaticMarkup(<StartupSkeleton />)),
    )
  })

  it("covers the window from outside React's root, hidden from assistive technology", () => {
    expect(indexHtml).toContain('<div id="root"></div>')
    expect(indexHtml).toContain('<div id="startup-frame" aria-hidden="true" class="fixed inset-0">')
  })

  it('warms the fonts only once React renders the frame, after the first paint', () => {
    expect(pageStartupFrame()).not.toContain('data-startup-font-warmup')
    expect(renderToStaticMarkup(<StartupSkeleton />)).toMatch(
      /<div aria-hidden="true" data-startup-font-warmup="" class="sr-only"><span class="text-sm">Aa<\/span>/u,
    )
  })

  it("paints the new-chat screen's mark inlined and decoded with the first frame", () => {
    const frame = pageStartupFrame()

    expect(frame).toContain('src="./src/assets/openwaggle-mark.png?inline" alt="" decoding="sync"')
    expect(renderToStaticMarkup(<StartupSkeleton />)).toMatch(
      /<img src="data:image\/png;base64,[^"]+" alt="" decoding="sync" class="size-20 object-contain"\/>/u,
    )
  })
})
