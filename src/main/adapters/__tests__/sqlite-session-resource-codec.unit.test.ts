import { describe, expect, it } from 'vitest'
import {
  rowToResource,
  type SessionResourceOccurrenceRow,
  type SessionResourceRow,
} from '../sqlite-session-resource-codec'

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
  is_source: 1,
  is_output: 0,
  created_at: 1,
  updated_at: 1,
}

const BASE_OCCURRENCE_ROW: SessionResourceOccurrenceRow = {
  id: 'occurrence-1',
  resource_id: 'resource-1',
  node_id: 'node-1',
  branch_id: 'branch-1',
  actor: 'agent',
  activity: 'read',
  label: null,
  locator: null,
  created_at: 1,
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

  it('normalizes each occurrence locator independently from the resource fallback', () => {
    const resource = rowToResource(BASE_ROW, [
      { ...BASE_OCCURRENCE_ROW, locator: 'HTTPS://EXAMPLE.COM/first.png' },
      {
        ...BASE_OCCURRENCE_ROW,
        id: 'occurrence-2',
        locator: '/worktree/second.png',
        created_at: 2,
      },
    ])

    expect(resource.occurrences.map((occurrence) => occurrence.locator)).toEqual([
      'https://example.com/first.png',
      '/worktree/second.png',
    ])
    expect(resource.locator).toBe('https://example.com/image.png')
  })
})
