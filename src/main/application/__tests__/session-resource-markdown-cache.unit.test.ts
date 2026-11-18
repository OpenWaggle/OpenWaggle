import { describe, expect, it } from 'vitest'
import { collectExplicitResources } from '../session-resource-extraction'
import { markdownCandidateCacheSize } from '../session-resource-markdown-extraction'

describe('session resource Markdown parse cache', () => {
  it('parses a text once however often a backfill reads it, with identical results', () => {
    const text = `cache probe ${String(Math.random())}\n[Docs](https://example.test/docs)\n![Shot](/tmp/shot.png)`
    const before = markdownCandidateCacheSize()
    const first = collectExplicitResources(text)
    expect(markdownCandidateCacheSize()).toBe(before + 1)
    const second = collectExplicitResources(text)
    expect(markdownCandidateCacheSize()).toBe(before + 1)

    expect(second).toEqual(first)
    expect(first.links).toEqual([{ url: 'https://example.test/docs', title: 'Docs', image: false }])
    expect(first.images).toEqual([
      { filePath: '/tmp/shot.png', mimeType: 'image/png', title: 'Shot' },
    ])
  })

  it('hands every caller its own resource objects', () => {
    const text = `isolation probe ${String(Math.random())} [Docs](https://example.test/isolated)`
    const first = collectExplicitResources(text)
    const link = first.links[0]
    if (!link) throw new Error('Link missing.')
    Object.assign(link, { title: 'mutated' })
    expect(collectExplicitResources(text).links[0]?.title).toBe('Docs')
  })

  it('keys cached candidates by image origin', () => {
    const text = `origin probe ${String(Math.random())} ![Logo](/logo.png)`
    const local = collectExplicitResources(text)
    const website = collectExplicitResources(text, { kind: 'website', origin: 'https://site.test' })
    expect(local.links).toEqual([])
    expect(website.links).toEqual([
      { url: 'https://site.test/logo.png', title: 'Logo', image: true },
    ])
  })
})
