import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  changelogEntry,
  changelogEntryDate,
  generatedReleaseNotes,
  isStableAppVersion,
  prepareChangelog,
  type ReleaseCommit,
  reservedHeadingProblems,
  unreleasedNotes,
} from '../app-release-notes'

const SHA = 'a'.repeat(40)
const OTHER_SHA = 'b'.repeat(40)

const CHANGELOG = `# Changelog

Intro.

## [Unreleased]

## [1.1.0] - 2026-11-02

Adds things.

## 1.0.0

### Sessions

- First stable.

## [1.0.0-rc.2] - 2026-10-01

RC notes
`

function commit(subject: string, body = '', sha = SHA) {
  return { sha, subject, body } satisfies ReleaseCommit
}

const COMMITS = [
  commit('feat(attachments): accept pasted screenshots (#481)'),
  commit('fix: keep the queue (#12)'),
  commit('perf(startup): start faster', '', OTHER_SHA),
  commit('docs: explain the queue (#13)'),
  commit('chore(release): v1.1.0 (#14)'),
  commit('Merge branch main'),
  commit('feat(cli)!: rename the flags (#432)'),
  commit('refactor(host): drop the old socket (#20)', 'BREAKING CHANGE: the socket moved.'),
]

describe('app release notes', () => {
  it('reads an entry under a bracketed or legacy heading, up to the next entry', () => {
    expect(changelogEntry(CHANGELOG, '1.0.0')).toBe('### Sessions\n\n- First stable.')
    expect(changelogEntry(CHANGELOG, '1.1.0')).toBe('Adds things.')
    expect(changelogEntry(CHANGELOG, '1.0.0-rc.2')).toBe('RC notes')
  })

  it('reports a missing or empty entry', () => {
    expect(changelogEntry(CHANGELOG, '1.2.0')).toBeNull()
    expect(changelogEntry('## 1.3.0\n\n## 1.2.0\n', '1.3.0')).toBeNull()
    expect(changelogEntry('', '1.0.0')).toBeNull()
  })

  it('never treats a prerelease heading as the Stable entry', () => {
    expect(changelogEntry('## 1.0.0-rc.2\n\nRC notes\n', '1.0.0')).toBeNull()
  })

  it('reads the date a release PR wrote into its heading', () => {
    expect(changelogEntryDate(CHANGELOG, '1.1.0')).toBe('2026-11-02')
    expect(changelogEntryDate(CHANGELOG, '1.0.0')).toBeNull()
    expect(changelogEntryDate(CHANGELOG, '9.9.9')).toBeNull()
  })

  it('distinguishes Stable versions from prereleases', () => {
    expect(isStableAppVersion('1.0.0')).toBe(true)
    expect(isStableAppVersion('1.0.0-rc.1')).toBe(false)
  })
})

describe('generated release notes', () => {
  it('groups breaking changes, features, fixes and performance work, and links each change', () => {
    expect(generatedReleaseNotes(COMMITS)).toBe(
      [
        '### Breaking changes',
        '',
        '- **cli:** rename the flags ([#432](https://github.com/OpenWaggle/OpenWaggle/pull/432))',
        '- **host:** drop the old socket ([#20](https://github.com/OpenWaggle/OpenWaggle/pull/20))',
        '',
        '### Features',
        '',
        '- **attachments:** accept pasted screenshots ([#481](https://github.com/OpenWaggle/OpenWaggle/pull/481))',
        '',
        '### Fixes',
        '',
        '- keep the queue ([#12](https://github.com/OpenWaggle/OpenWaggle/pull/12))',
        '',
        '### Performance',
        '',
        `- **startup:** start faster ([bbbbbbb](https://github.com/OpenWaggle/OpenWaggle/commit/${OTHER_SHA}))`,
      ].join('\n'),
    )
  })

  it('is empty when no commit is a feature, fix, performance or breaking change', () => {
    expect(generatedReleaseNotes([commit('docs: a guide'), commit('not conventional')])).toBe('')
  })
})

describe('the changelog a release PR writes', () => {
  const withNotes = CHANGELOG.replace(
    '## [Unreleased]\n',
    '## [Unreleased]\n\n### Highlights\n\n- Hand-written.\n',
  )

  it('adds a prerelease entry under Unreleased and keeps the notes for the next Stable release', () => {
    const changelog = prepareChangelog({
      changelog: withNotes,
      version: '1.2.0-beta.1',
      date: '2026-11-20',
      commits: [commit('fix: keep the queue (#12)')],
      previousTag: 'v1.1.0',
    })

    expect(changelog).toBe(
      withNotes.replace(
        '- Hand-written.\n',
        '- Hand-written.\n\n## [1.2.0-beta.1] - 2026-11-20\n\n### Fixes\n\n- keep the queue ([#12](https://github.com/OpenWaggle/OpenWaggle/pull/12))\n',
      ),
    )
    expect(unreleasedNotes(changelog)).toBe('### Highlights\n\n- Hand-written.')
  })

  it('starts a Stable entry with the Unreleased notes and empties that section', () => {
    const changelog = prepareChangelog({
      changelog: withNotes,
      version: '1.2.0',
      date: '2026-11-21',
      commits: [commit('feat: add a thing (#15)')],
      previousTag: 'v1.2.0-beta.1',
    })

    expect(unreleasedNotes(changelog)).toBe('')
    expect(changelogEntry(changelog, '1.2.0')).toBe(
      '### Highlights\n\n- Hand-written.\n\n### Features\n\n- add a thing ([#15](https://github.com/OpenWaggle/OpenWaggle/pull/15))',
    )
    expect(changelogEntry(changelog, '1.1.0')).toBe('Adds things.')
    expect(
      changelog.startsWith('# Changelog\n\nIntro.\n\n## [Unreleased]\n\n## [1.2.0] - 2026-11-21\n'),
    ).toBe(true)
  })

  it('says so when nothing user-facing changed since the previous release', () => {
    const changelog = prepareChangelog({
      changelog: CHANGELOG,
      version: '1.1.1-rc.1',
      date: '2026-11-21',
      commits: [commit('docs: a guide')],
      previousTag: 'v1.1.0',
    })

    expect(changelogEntry(changelog, '1.1.1-rc.1')).toBe(
      'No feature, fix or performance changes since v1.1.0.',
    )
  })

  it('keeps a fenced `## ` line inside the hand-written notes', () => {
    const notes =
      '### Upgrade notes\n\n~~~md\n```sh\n~~\n## not a heading\n```\n~~~\n\n```sh\n## nor this\n```'
    const changelog = prepareChangelog({
      changelog: CHANGELOG.replace('## [Unreleased]\n', `## [Unreleased]\n\n${notes}\n`),
      version: '1.2.0',
      date: '2026-11-21',
      commits: [],
      previousTag: 'v1.1.0',
    })

    expect(changelogEntry(changelog, '1.2.0')).toBe(notes)
  })

  it('needs hand-written notes for a new major version', () => {
    expect(() =>
      prepareChangelog({
        changelog: CHANGELOG,
        version: '2.0.0',
        date: '2026-11-21',
        commits: COMMITS,
        previousTag: 'v2.0.0-rc.1',
      }),
    ).toThrow('Stable 2.0.0 is a new major version')
  })

  it('refuses hand-written notes that use a heading the release PR writes', () => {
    expect(reservedHeadingProblems('### Highlights\n\n### Fixes\n')).toEqual([
      '"### Fixes" is written by the release PR; give hand-written notes another heading, such as "### Highlights".',
    ])
    expect(() =>
      prepareChangelog({
        changelog: CHANGELOG.replace(
          '## [Unreleased]\n',
          '## [Unreleased]\n\n### Features\n\n- x\n',
        ),
        version: '1.2.0',
        date: '2026-11-21',
        commits: [],
        previousTag: 'v1.1.0',
      }),
    ).toThrow('"### Features" is written by the release PR')
  })

  it('fails closed on a missing Unreleased heading, an existing entry or an invalid date', () => {
    const input = { commits: [], previousTag: 'v1.1.0', date: '2026-11-21' }
    expect(() =>
      prepareChangelog({ ...input, changelog: '# Changelog\n', version: '1.2.0' }),
    ).toThrow('CHANGELOG.md has no "## [Unreleased]" heading.')
    expect(() => prepareChangelog({ ...input, changelog: CHANGELOG, version: '1.1.0' })).toThrow(
      'CHANGELOG.md already has an entry for 1.1.0.',
    )
    expect(() =>
      prepareChangelog({ ...input, changelog: CHANGELOG, version: '1.2.0', date: 'today' }),
    ).toThrow('Invalid changelog date: today.')
  })
})

describe("the repository's CHANGELOG.md", () => {
  const changelog = fs.readFileSync('CHANGELOG.md', 'utf8')

  it('has an Unreleased section whose notes a Stable release PR can take', () => {
    expect(reservedHeadingProblems(unreleasedNotes(changelog))).toEqual([])
  })

  it('has one dated entry per version', () => {
    const versions = [...changelog.matchAll(/^## \[(?<version>[^\]]+)\](?<rest>.*)$/gmu)]
      .map((match) => match.groups ?? {})
      .filter(({ version }) => version !== 'Unreleased')
    expect(versions.length).toBeGreaterThan(0)
    for (const { version = '', rest = '' } of versions) {
      expect(rest).toMatch(/^ - \d{4}-\d{2}-\d{2}$/u)
      expect(changelogEntryDate(changelog, version)).not.toBeNull()
    }
    expect(new Set(versions.map(({ version }) => version)).size).toBe(versions.length)
  })
})
