import { readFileSync } from 'node:fs'
import path from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { StartupSkeleton } from '../StartupSkeleton'

// Component tests run from the repository root.
const INDEX_HTML = path.resolve('src/renderer/index.html')

/** The markup the page paints before its scripts run: everything inside `#root`. */
function pageStartupFrame() {
  const html = readFileSync(INDEX_HTML, 'utf8')
  const match = /<div id="root">([\s\S]*?<\/main>)<\/div>/u.exec(html)
  if (!match?.[1]) throw new Error('index.html has no startup frame inside #root')
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

  it("paints the new-chat screen's mark inlined and decoded with the first frame", () => {
    const frame = pageStartupFrame()

    expect(frame).toContain('src="./src/assets/openwaggle-mark.png?inline" alt="" decoding="sync"')
    expect(renderToStaticMarkup(<StartupSkeleton />)).toMatch(
      /<img src="data:image\/png;base64,[^"]+" alt="" decoding="sync" class="size-20 object-contain"\/>/u,
    )
  })
})
