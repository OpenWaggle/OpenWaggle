import { describe, expect, it } from 'vitest'
import { rowToResource, type SessionResourceRow } from '../sqlite-session-resource-codec'

const BASE_ROW: SessionResourceRow = {
  id: 'resource-1',
  session_id: 'session-1',
  canonical_key: 'url:HTTPS://EXAMPLE.COM/image.png',
  kind: 'image',
  title: 'Legacy image',
  mime_type: null,
  locator: 'HTTPS://EXAMPLE.COM/image.png',
  managed_path: null,
  available: 1,
  created_at: 1,
  updated_at: 1,
}

describe('sqlite session resource codec', () => {
  it('normalizes legacy HTTP locators at the persistence boundary', () => {
    expect(rowToResource(BASE_ROW, []).locator).toBe('https://example.com/image.png')
  })

  it('preserves non-HTTP and credentialed locators', () => {
    expect(
      ['/project/image.png', 'HTTPS://user:secret@EXAMPLE.COM/image.png'].map(
        (locator) => rowToResource({ ...BASE_ROW, locator }, []).locator,
      ),
    ).toEqual(['/project/image.png', 'HTTPS://user:secret@EXAMPLE.COM/image.png'])
  })
})
