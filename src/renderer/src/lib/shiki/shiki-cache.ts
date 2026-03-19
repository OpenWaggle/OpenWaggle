/**
 * LRU cache for Shiki-highlighted HAST nodes.
 *
 * Stores pre-highlighted `<code>` Element nodes keyed by a fast hash of
 * (language + code). Uses Map insertion-order semantics for O(1) LRU eviction.
 */
import type { Element } from 'hast'

const MAX_ENTRIES = 500
const HASH_SEPARATOR = '\0'
const CYRB53_SEED_ONE = 0xdeadbeef
const CYRB53_SEED_TWO = 0x41c6ce57
const CYRB53_MIX_MULTIPLIER_ONE = 2654435761
const CYRB53_MIX_MULTIPLIER_TWO = 1597334677
const CYRB53_AVALANCHE_SHIFT_ONE = 16
const CYRB53_AVALANCHE_SHIFT_TWO = 13
const CYRB53_AVALANCHE_MULTIPLIER_ONE = 2246822507
const CYRB53_AVALANCHE_MULTIPLIER_TWO = 3266489909
const UINT32_RANGE = 4294967296
const CYRB53_HIGH_MASK = 2097151

/**
 * cyrb53 — fast, high-quality 53-bit hash.
 * Returns a numeric string key for Map storage.
 */
function cyrb53(str: string, seed = 0): string {
  let h1 = CYRB53_SEED_ONE ^ seed
  let h2 = CYRB53_SEED_TWO ^ seed
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, CYRB53_MIX_MULTIPLIER_ONE)
    h2 = Math.imul(h2 ^ ch, CYRB53_MIX_MULTIPLIER_TWO)
  }
  h1 = Math.imul(h1 ^ (h1 >>> CYRB53_AVALANCHE_SHIFT_ONE), CYRB53_AVALANCHE_MULTIPLIER_ONE)
  h1 ^= Math.imul(h2 ^ (h2 >>> CYRB53_AVALANCHE_SHIFT_TWO), CYRB53_AVALANCHE_MULTIPLIER_TWO)
  h2 = Math.imul(h2 ^ (h2 >>> CYRB53_AVALANCHE_SHIFT_ONE), CYRB53_AVALANCHE_MULTIPLIER_ONE)
  h2 ^= Math.imul(h1 ^ (h1 >>> CYRB53_AVALANCHE_SHIFT_TWO), CYRB53_AVALANCHE_MULTIPLIER_TWO)
  return String(UINT32_RANGE * (CYRB53_HIGH_MASK & h2) + (h1 >>> 0))
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
