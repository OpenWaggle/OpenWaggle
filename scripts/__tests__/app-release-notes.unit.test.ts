import { describe, expect, it } from 'vitest'
import { changelogEntry, isStableAppVersion } from '../app-release-notes'

const CHANGELOG = `# Changelog

Earlier 0.x builds used a legacy release process and remain listed in GitHub Releases.

## [1.1.0] - 2026-11-02

Adds things.

## 1.0.0 - 2026-10-10

### Sessions

- First stable.

## 1.0.0-rc.2

Not a Stable entry.
`

describe('app release notes', () => {
  it('reads the entry for one Stable version up to the next entry', () => {
    expect(changelogEntry(CHANGELOG, '1.0.0')).toBe('### Sessions\n\n- First stable.')
    expect(changelogEntry(CHANGELOG, '1.1.0')).toBe('Adds things.')
  })

  it('reports a missing or empty entry', () => {
    expect(changelogEntry(CHANGELOG, '1.2.0')).toBeNull()
    expect(changelogEntry('## 1.3.0\n\n## 1.2.0\n', '1.3.0')).toBeNull()
    expect(changelogEntry('', '1.0.0')).toBeNull()
  })

  it('never treats a prerelease heading as the Stable entry', () => {
    expect(changelogEntry('## 1.0.0-rc.2\n\nRC notes\n', '1.0.0')).toBeNull()
  })

  it('distinguishes Stable versions from prereleases', () => {
    expect(isStableAppVersion('1.0.0')).toBe(true)
    expect(isStableAppVersion('1.0.0-rc.1')).toBe(false)
  })
})
