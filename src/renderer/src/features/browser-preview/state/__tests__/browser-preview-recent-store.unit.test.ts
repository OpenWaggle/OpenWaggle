import { beforeEach, describe, expect, it } from 'vitest'
import {
  BROWSER_PREVIEW_RECENT_URL_LIMIT,
  sanitizeBrowserPreviewRecentUrls,
  useBrowserPreviewRecentStore,
} from '../browser-preview-recent-store'

describe('browser preview recent URLs', () => {
  beforeEach(() => {
    useBrowserPreviewRecentStore.setState({ entries: [] })
  })

  it('normalizes, deduplicates, bounds, and rejects unsafe persisted entries', () => {
    const candidates = Array.from({ length: BROWSER_PREVIEW_RECENT_URL_LIMIT + 2 }, (_, index) => ({
      url: `localhost:${String(3_000 + index)}`,
      title: ` Local ${String(index)} `,
      visitedAt: index,
    }))

    expect(
      sanitizeBrowserPreviewRecentUrls([
        ...candidates,
        candidates[0],
        { url: 'file:///private/token', title: 'Unsafe', visitedAt: 1 },
      ]),
    ).toEqual(
      candidates.slice(0, BROWSER_PREVIEW_RECENT_URL_LIMIT).map((entry) => ({
        ...entry,
        url: `http://${entry.url}/`,
        title: entry.title.trim(),
      })),
    )
  })

  it('moves a revisited URL to the front without creating a duplicate', () => {
    const store = useBrowserPreviewRecentStore.getState()
    store.remember({ url: 'https://example.com/', title: 'First', visitedAt: 1 })
    store.remember({ url: 'http://localhost:3000/', title: 'Local', visitedAt: 2 })
    store.remember({ url: 'https://example.com/', title: 'Updated', visitedAt: 3 })

    expect(useBrowserPreviewRecentStore.getState().entries).toEqual([
      { url: 'https://example.com/', title: 'Updated', visitedAt: 3 },
      { url: 'http://localhost:3000/', title: 'Local', visitedAt: 2 },
    ])
  })
})
