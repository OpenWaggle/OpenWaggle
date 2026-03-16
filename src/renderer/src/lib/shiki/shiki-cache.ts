/**
 * LRU cache for Shiki-highlighted HAST nodes.
 *
 * Stores pre-highlighted `<code>` Element nodes keyed by a fast hash of
 * (language + code). Uses Map insertion-order semantics for O(1) LRU eviction.
 */
import type { Element } from 'hast'

const MAX_ENTRIES = 500
const HASH_SEPARATOR = '\0'

/**
 * cyrb53 — fast, high-quality 53-bit hash.
 * Returns a numeric string key for Map storage.
 */
function cyrb53(str: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed
  let h2 = 0x41c6ce57 ^ seed
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507)
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507)
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return String(4294967296 * (2097151 & h2) + (h1 >>> 0))
}

function cacheKey(language: string, code: string): string {
  return cyrb53(language + HASH_SEPARATOR + code)
}

export class ShikiCache {
  private readonly map = new Map<string, Element>()
  private readonly maxEntries: number

  constructor(maxEntries = MAX_ENTRIES) {
    this.maxEntries = maxEntries
  }

  get(language: string, code: string): Element | undefined {
    const key = cacheKey(language, code)
    const entry = this.map.get(key)
    if (entry === undefined) return undefined

    // Move to end (most recently used) by re-inserting
    this.map.delete(key)
    this.map.set(key, entry)
    return entry
  }

  set(language: string, code: string, element: Element): void {
    const key = cacheKey(language, code)

    // Delete first so re-insertion moves to end
    if (this.map.has(key)) {
      this.map.delete(key)
    }

    this.map.set(key, element)

    // Evict oldest if over capacity
    if (this.map.size > this.maxEntries) {
      const oldest = this.map.keys().next()
      if (!oldest.done) {
        this.map.delete(oldest.value)
      }
    }
  }

  clear(): void {
    this.map.clear()
  }

  get size(): number {
    return this.map.size
  }
}
