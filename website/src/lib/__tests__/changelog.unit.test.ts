import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  buildChangelogFeed,
  changelogAnchor,
  formatChangelogDate,
  githubReleaseUrl,
  parseChangelog,
  scopeHeadingIds,
} from '../changelog'

const FIXTURE = `# Changelog

Intro paragraph with a [link](https://github.com/OpenWaggle/OpenWaggle/releases).

## [Unreleased]

Hand-written notes for the next Stable release, never published.

## [1.0.0] - 2026-12-01

### Highlights

The first Stable release.

## [1.0.0-beta.44] - 2026-11-18

### Breaking changes

- **cli:** settle the machine-output contract before 1.0.0 ([#432](https://github.com/OpenWaggle/OpenWaggle/pull/432))

\`\`\`md
## Not a heading inside a fence
\`\`\`

### Fixes

- fix without scope ([abc1234](https://github.com/OpenWaggle/OpenWaggle/commit/abc1234))

## 0.9.0

Legacy entry.
`

describe('parseChangelog', () => {
  it('reads bracketed, prerelease and legacy entries newest first, skipping the preamble and Unreleased', () => {
    const entries = parseChangelog(FIXTURE)
    expect(entries.map(({ version, date }) => ({ version, date }))).toEqual([
      { version: '1.0.0', date: '2026-12-01' },
      { version: '1.0.0-beta.44', date: '2026-11-18' },
      { version: '0.9.0', date: undefined },
    ])
    expect(entries[0]?.body).toBe('### Highlights\n\nThe first Stable release.')
    expect(entries[1]?.body).toContain('## Not a heading inside a fence')
    expect(entries[1]?.body).toMatch(/### Fixes[\s\S]*abc1234/u)
    expect(entries[2]).not.toHaveProperty('date')
    expect(entries.map(({ body }) => body).join('\n')).not.toMatch(/never published|Intro/u)
  })

  it('accepts a compare link after the bracketed version and CRLF line endings', () => {
    const source = '## [2.1.0](https://example.com/compare) - 2027-01-02\r\n\r\n- note\r\n'
    expect(parseChangelog(source)).toEqual([
      { version: '2.1.0', date: '2027-01-02', body: '- note' },
    ])
  })

  it.each([
    ['an empty file', ''],
    ['only a title', '# Changelog\n\nNothing yet.\n'],
    ['only Unreleased notes', '# Changelog\n\n## [Unreleased]\n\n- next\n'],
  ])('has no entries for %s', (_name, source) => {
    expect(parseChangelog(source)).toEqual([])
  })

  it.each([
    ['an unknown heading', '## Upcoming\n', /neither/u],
    ['an unknown release stage', '## [1.0.0-next.1] - 2026-01-01\n', /release stage/u],
    ['an impossible date', '## [1.0.0] - 2026-02-30\n', /invalid date/u],
    ['a repeated version', '## [1.0.0] - 2026-01-01\n## 1.0.0\n', /twice/u],
  ])('fails the build on %s instead of dropping the entry', (_name, source, error) => {
    expect(() => parseChangelog(source)).toThrow(error)
  })
})

describe('entry links and labels', () => {
  it('derives the anchor, release URL and human date', () => {
    expect(changelogAnchor('1.0.0-beta.44')).toBe('v1-0-0-beta-44')
    expect(githubReleaseUrl('1.0.0-rc.1')).toBe(
      'https://github.com/OpenWaggle/OpenWaggle/releases/tag/v1.0.0-rc.1',
    )
    expect(formatChangelogDate('2026-11-18')).toBe('November 18, 2026')
  })

  // Every release has a "### Features" heading, which would otherwise repeat id="features".
  it('scopes heading ids to the entry', () => {
    expect(scopeHeadingIds('<h3 id="features">Features</h3><p id="x">x</p>', 'v1-0-0')).toBe(
      '<h3 id="v1-0-0-features">Features</h3><p id="x">x</p>',
    )
  })
})

describe('buildChangelogFeed', () => {
  const feed = buildChangelogFeed({
    description: 'Releases & fixes',
    items: [
      { version: '1.0.0', html: '<p><a href="/docs/x/">docs</a> ]]> end</p>' },
      { version: '1.0.0-beta.44', date: '2026-11-18', html: '<p>beta</p>' },
    ],
  })

  it('writes an RSS 2.0 channel with one item per entry', () => {
    expect(feed).toMatch(/^<\?xml version="1\.0" encoding="UTF-8"\?>\n<rss version="2\.0"/u)
    expect(feed).toContain('<description>Releases &amp; fixes</description>')
    expect(feed).toContain(
      '<atom:link href="https://openwaggle.ai/changelog/rss.xml" rel="self" type="application/rss+xml" />',
    )
    expect(feed).toContain('<lastBuildDate>Wed, 18 Nov 2026 00:00:00 GMT</lastBuildDate>')
    expect(feed.match(/<item>/gu)).toHaveLength(2)
    expect(feed).toContain(
      '<guid isPermaLink="true">https://openwaggle.ai/changelog/#v1-0-0-beta-44</guid>',
    )
    expect(feed.match(/<pubDate>/gu)).toHaveLength(1)
  })

  it('makes site links absolute and keeps "]]>" from closing the CDATA section', () => {
    expect(feed).toContain('<a href="https://openwaggle.ai/docs/x/">docs</a> ]]]]><![CDATA[> end')
  })

  it('is still a valid channel with no entries', () => {
    const empty = buildChangelogFeed({ description: 'None yet', items: [] })
    expect(empty).not.toContain('<item>')
    expect(empty).not.toContain('<lastBuildDate>')
    expect(empty).toContain('</channel>\n</rss>')
  })
})

describe("the repository's CHANGELOG.md", () => {
  // The website build reads this file; parse it on every PR, since release PRs and edits to its
  // Unreleased notes do not run the website build.
  it('parses into dated entries, newest first', () => {
    const entries = parseChangelog(
      fs.readFileSync(new URL('../../../../CHANGELOG.md', import.meta.url), 'utf8'),
    )

    expect(entries.length).toBeGreaterThan(0)
    for (const entry of entries) expect(entry.date).toMatch(/^\d{4}-\d{2}-\d{2}$/u)
    const dates = entries.map((entry) => entry.date ?? '')
    expect(dates).toEqual([...dates].sort().reverse())
  })
})
