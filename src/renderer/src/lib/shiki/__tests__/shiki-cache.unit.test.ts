import { describe, expect, it } from 'vitest'
import { ShikiCache } from '../shiki-cache'

function makeElement(text: string) {
  return {
    type: 'element' as const,
    tagName: 'code',
    properties: {},
    children: [{ type: 'text' as const, value: text }],
  }
}

describe('ShikiCache', () => {
  it('returns undefined on cache miss', () => {
    const cache = new ShikiCache()
    expect(cache.get('typescript', 'const x = 1')).toBeUndefined()
  })

  it('returns cached element on cache hit', () => {
    const cache = new ShikiCache()
    const element = makeElement('highlighted')
    cache.set('typescript', 'const x = 1', element)
    expect(cache.get('typescript', 'const x = 1')).toBe(element)
  })

  it('distinguishes entries by language', () => {
    const cache = new ShikiCache()
    const tsElement = makeElement('ts-highlighted')
    const jsElement = makeElement('js-highlighted')
    cache.set('typescript', 'const x = 1', tsElement)
    cache.set('javascript', 'const x = 1', jsElement)
    expect(cache.get('typescript', 'const x = 1')).toBe(tsElement)
    expect(cache.get('javascript', 'const x = 1')).toBe(jsElement)
  })

  it('distinguishes entries by code content', () => {
    const cache = new ShikiCache()
    const el1 = makeElement('one')
    const el2 = makeElement('two')
    cache.set('typescript', 'const x = 1', el1)
    cache.set('typescript', 'const y = 2', el2)
    expect(cache.get('typescript', 'const x = 1')).toBe(el1)
    expect(cache.get('typescript', 'const y = 2')).toBe(el2)
  })

  it('evicts least-recently-used entry when over capacity', () => {
    const capacity = 3
    const cache = new ShikiCache(capacity)

    cache.set('a', '1', makeElement('a1'))
    cache.set('b', '2', makeElement('b2'))
    cache.set('c', '3', makeElement('c3'))

    // Cache is full (3/3). Adding one more should evict 'a:1'
    cache.set('d', '4', makeElement('d4'))

    expect(cache.size).toBe(capacity)
    expect(cache.get('a', '1')).toBeUndefined()
    expect(cache.get('b', '2')).toBeDefined()
    expect(cache.get('c', '3')).toBeDefined()
    expect(cache.get('d', '4')).toBeDefined()
  })

  it('promotes accessed entries (LRU get refreshes position)', () => {
    const capacity = 3
    const cache = new ShikiCache(capacity)

    cache.set('a', '1', makeElement('a1'))
    cache.set('b', '2', makeElement('b2'))
    cache.set('c', '3', makeElement('c3'))

    // Access 'a' to move it to most-recently-used
    cache.get('a', '1')

    // Add new entry — 'b' is now the least recently used and should be evicted
    cache.set('d', '4', makeElement('d4'))

    expect(cache.get('a', '1')).toBeDefined()
    expect(cache.get('b', '2')).toBeUndefined()
    expect(cache.get('c', '3')).toBeDefined()
    expect(cache.get('d', '4')).toBeDefined()
  })

  it('updates existing entry in-place without growing size', () => {
    const cache = new ShikiCache()
    const el1 = makeElement('v1')
    const el2 = makeElement('v2')

    cache.set('ts', 'code', el1)
    expect(cache.size).toBe(1)

    cache.set('ts', 'code', el2)
    expect(cache.size).toBe(1)
    expect(cache.get('ts', 'code')).toBe(el2)
  })

  it('clear() removes all entries', () => {
    const cache = new ShikiCache()
    cache.set('a', '1', makeElement('a'))
    cache.set('b', '2', makeElement('b'))
    expect(cache.size).toBe(2)

    cache.clear()
    expect(cache.size).toBe(0)
    expect(cache.get('a', '1')).toBeUndefined()
  })

  it('reports size correctly', () => {
    const cache = new ShikiCache()
    expect(cache.size).toBe(0)
    cache.set('a', '1', makeElement('a'))
    expect(cache.size).toBe(1)
    cache.set('b', '2', makeElement('b'))
    expect(cache.size).toBe(2)
  })
})
