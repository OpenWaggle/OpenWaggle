import { describe, expect, it } from 'vitest'
import { browserPreviewPartition, isBrowserPreviewPartition } from '../browser-preview-partitions'

describe('browser preview partitions', () => {
  it('preserves the legacy default and separates persistent and ephemeral profiles', () => {
    expect(browserPreviewPartition('default')).toBe('persist:openwaggle-browser-preview')
    expect(browserPreviewPartition('incognito')).toBe('openwaggle-browser-preview-incognito')
    expect(browserPreviewPartition('work')).toMatch(
      /^persist:openwaggle-browser-preview-profile-[a-f0-9]{20}$/,
    )
    expect(browserPreviewPartition('work')).not.toBe(browserPreviewPartition('personal'))
    expect(isBrowserPreviewPartition(browserPreviewPartition('work'))).toBe(true)
    expect(isBrowserPreviewPartition('persist:other-app')).toBe(false)
  })

  it('does not collapse malformed UTF-16 and its replacement character', () => {
    expect(browserPreviewPartition('p\ud800')).not.toBe(browserPreviewPartition('p\ufffd'))
  })
})
