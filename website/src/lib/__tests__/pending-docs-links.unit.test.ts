import { describe, expect, it } from 'vitest'
import { docsPageFiles, PENDING_LINE } from './docs-page-files'

/** Promotion writes `api-reference` into every new line, so a pending page may link to it before it exists. */
const GENERATED_PAGES = ['api-reference']
const RELATIVE_LINK = /\]\((\.{1,2}\/[^)\s#?]*)/gu

/** The URL a promoted page is served at: a directory, so `./x` from `components` means `components/x`. */
function pageUrl(slug: string) {
  return new URL(`https://docs.invalid/${slug.replace(/\/index$/u, '')}/`)
}

describe('pending package docs links', () => {
  const pending = docsPageFiles().filter((file) => file.pending)

  it('resolve relative links to a page of the same pending line', () => {
    const broken = pending.flatMap((file) => {
      const lineRoot = file.slug.slice(
        0,
        file.slug.indexOf(`/${PENDING_LINE}/`) + PENDING_LINE.length + 2,
      )
      const targets = new Set([
        ...pending
          .filter((page) => page.slug.startsWith(lineRoot))
          .map((page) => page.slug.replace(/\/index$/u, '')),
        ...GENERATED_PAGES.map((page) => `${lineRoot}${page}`),
        lineRoot.slice(0, -1),
      ])
      return [...file.text.matchAll(RELATIVE_LINK)].flatMap(([, link = '']) => {
        const resolved = new URL(link, pageUrl(file.slug)).pathname
          .replace(/^\//u, '')
          .replace(/\/$/u, '')
        return targets.has(resolved) ? [] : [`${file.slug}: ${link} resolves to ${resolved}`]
      })
    })
    expect(broken).toEqual([])
  })
})
