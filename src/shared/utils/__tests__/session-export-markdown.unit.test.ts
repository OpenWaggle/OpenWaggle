import { describe, expect, it } from 'vitest'
import { sessionExportMarkdownHeading } from '../session-export-markdown'

describe('sessionExportMarkdownHeading', () => {
  it('heads the Host’s Hive wake notice as hive, not as the user', () => {
    expect(sessionExportMarkdownHeading({ role: 'user', metadata: {} })).toBe('user')
    expect(sessionExportMarkdownHeading({ role: 'user', metadata: { hiveWake: true } })).toBe(
      'hive',
    )
    expect(sessionExportMarkdownHeading({ role: null, metadata: null })).toBe('event')
  })
})
