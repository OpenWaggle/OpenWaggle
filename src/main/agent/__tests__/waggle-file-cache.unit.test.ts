import { describe, expect, it } from 'vitest'
import { WaggleFileCache } from '../waggle-file-cache'

describe('WaggleFileCache', () => {
  it('stores and retrieves file content', () => {
    const cache = new WaggleFileCache()
    cache.set('/project/src/index.ts', 'const x = 1', 'Advocate')

    const entry = cache.get('/project/src/index.ts')
    expect(entry).toEqual({ content: 'const x = 1', readBy: 'Advocate' })
  })

  it('returns undefined for uncached paths', () => {
    const cache = new WaggleFileCache()
    expect(cache.get('/nonexistent')).toBeUndefined()
  })

  it('reports has() correctly', () => {
    const cache = new WaggleFileCache()
    expect(cache.has('/file.ts')).toBe(false)
    cache.set('/file.ts', 'content', 'Critic')
    expect(cache.has('/file.ts')).toBe(true)
  })

  it('clears all entries', () => {
    const cache = new WaggleFileCache()
    cache.set('/a.ts', 'a', 'Agent A')
    cache.set('/b.ts', 'b', 'Agent B')
    expect(cache.size).toBe(2)

    cache.clear()
    expect(cache.size).toBe(0)
    expect(cache.get('/a.ts')).toBeUndefined()
  })

  it('overwrites existing entries', () => {
    const cache = new WaggleFileCache()
    cache.set('/file.ts', 'old content', 'Advocate')
    cache.set('/file.ts', 'new content', 'Critic')

    const entry = cache.get('/file.ts')
    expect(entry).toEqual({ content: 'new content', readBy: 'Critic' })
  })
})
