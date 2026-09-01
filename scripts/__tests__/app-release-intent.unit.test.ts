import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createAppReleasePlan,
  nextAppVersion,
  prepareAppRelease,
  readAppReleaseIntents,
  renderAppReleaseNotes,
  updateAppChangelog,
} from '../app-release-intent'

const tempRoots: string[] = []
const CHANGELOG = `# Changelog

Generated desktop app release history begins with release-intent adoption.
Older builds used the legacy release process and remain available in GitHub Releases.

<!-- app-release-history -->
`

function createProject(version = '0.3.0-alpha.64') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'openwaggle-release-intent-'))
  tempRoots.push(root)
  fs.mkdirSync(path.join(root, '.release', 'changes'), { recursive: true })
  fs.writeFileSync(
    path.join(root, 'package.json'),
    `${JSON.stringify({ name: 'openwaggle', private: true, version }, null, 2)}\n`,
  )
  fs.writeFileSync(path.join(root, 'CHANGELOG.md'), CHANGELOG)
  return root
}

function writeIntent(
  root: string,
  name: string,
  metadata = 'impact: minor\narea: sessions\naudience: prerelease-users\nmilestone: v1',
  body = 'A curated note with exact product wording.',
) {
  fs.writeFileSync(
    path.join(root, '.release', 'changes', name),
    `---\n${metadata}\n---\n\n${body}\n`,
  )
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { force: true, recursive: true })
})

describe('desktop app release intent', () => {
  it('validates and orders the exact schema deterministically', () => {
    const root = createProject()
    writeIntent(root, 'z-last.md')
    writeIntent(root, 'a-first.md', 'impact: patch\narea: ui\naudience: users\nmilestone: post-v1')

    expect(readAppReleaseIntents(root).map(({ file }) => file)).toEqual([
      '.release/changes/a-first.md',
      '.release/changes/z-last.md',
    ])
  })

  it.each([
    ['invalid YAML', 'impact: ['],
    ['unknown metadata', 'impact: patch\narea: ui\naudience: users\nmilestone: v1\nextra: no'],
    ['invalid enum', 'impact: gigantic\narea: ui\naudience: users\nmilestone: v1'],
    ['public none entry', 'impact: none\narea: ui\naudience: users\nmilestone: v1'],
    ['public internal entry', 'impact: patch\narea: internal\naudience: users\nmilestone: v1'],
  ])('rejects %s', (_label, metadata) => {
    const root = createProject()
    writeIntent(root, 'invalid.md', metadata)
    expect(() => readAppReleaseIntents(root)).toThrow()
  })

  it('derives prerelease increments and stable semver from the highest file impact', () => {
    const root = createProject()
    writeIntent(root, 'patch.md', 'impact: patch\narea: ui\naudience: users\nmilestone: v1')
    writeIntent(root, 'major.md', 'impact: major\narea: sessions\naudience: prerelease-users\nmilestone: v1')
    const plan = createAppReleasePlan('0.3.0-alpha.64', readAppReleaseIntents(root))

    expect(plan).toMatchObject({ impact: 'major', shouldRelease: true, version: '0.3.0-alpha.65' })
    expect(nextAppVersion('1.2.3', 'patch')).toBe('1.2.4')
    expect(nextAppVersion('1.2.3', 'minor')).toBe('1.3.0')
    expect(nextAppVersion('1.2.3', 'major')).toBe('2.0.0')
    expect(nextAppVersion('1.0.0-rc.2', 'patch')).toBe('1.0.0-rc.3')
  })

  it('does not release for no entries or developer audit entries alone', () => {
    const root = createProject()
    expect(createAppReleasePlan('1.0.0', readAppReleaseIntents(root))).toMatchObject({
      impact: null,
      shouldRelease: false,
      version: null,
    })
    writeIntent(root, 'audit.md', 'impact: none\narea: internal\naudience: developers\nmilestone: post-v1')
    expect(createAppReleasePlan('1.0.0', readAppReleaseIntents(root))).toMatchObject({
      impact: 'none',
      shouldRelease: false,
      version: null,
    })
  })

  it('treats a consumed, absent changes directory as an empty valid queue', () => {
    const root = createProject()
    fs.rmdirSync(path.join(root, '.release', 'changes'))

    expect(readAppReleaseIntents(root)).toEqual([])
    expect(createAppReleasePlan('1.0.0-alpha.1', readAppReleaseIntents(root))).toMatchObject({
      shouldRelease: false,
      version: null,
    })
  })

  it('renders the same curated bodies without developer notes in public release notes', () => {
    const root = createProject()
    writeIntent(root, 'public.md', undefined, 'Public wording\ncontinues exactly.')
    writeIntent(root, 'internal.md', 'impact: none\narea: internal\naudience: developers\nmilestone: v1', 'Internal audit wording.')
    const entries = readAppReleaseIntents(root)

    expect(renderAppReleaseNotes('0.3.0-alpha.65', entries)).toBe(
      '# OpenWaggle v0.3.0-alpha.65\n\n### Sessions\n\nPublic wording\ncontinues exactly.\n',
    )
    const changelog = updateAppChangelog(CHANGELOG, '0.3.0-alpha.65', '2026-09-01', entries)
    expect(changelog).toContain('Public wording\ncontinues exactly.')
    expect(changelog).toContain('Internal audit wording.')
  })

  it('atomically models the release tree: manifest, changelog, notes, and consumed files', () => {
    const root = createProject()
    writeIntent(root, 'session-host.md', undefined, 'Ship the durable Session Host.')

    prepareAppRelease(root, '0.3.0-alpha.65', '2026-09-01')

    expect(JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))).toMatchObject({
      version: '0.3.0-alpha.65',
    })
    expect(fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8')).toContain(
      '## v0.3.0-alpha.65 — 2026-09-01\n\n### Sessions\n\nShip the durable Session Host.',
    )
    expect(fs.readFileSync(path.join(root, '.release', 'release-notes.md'), 'utf8')).toBe(
      '# OpenWaggle v0.3.0-alpha.65\n\n### Sessions\n\nShip the durable Session Host.\n',
    )
    expect(fs.existsSync(path.join(root, '.release', 'changes'))).toBe(false)
  })

  it('fails closed when the requested version does not match the intent plan', () => {
    const root = createProject()
    writeIntent(root, 'session-host.md')
    expect(() => prepareAppRelease(root, '9.9.9', '2026-09-01')).toThrow(
      'Release plan resolves to 0.3.0-alpha.65, not requested v9.9.9.',
    )
    expect(fs.readdirSync(path.join(root, '.release', 'changes'))).toEqual(['session-host.md'])
  })

  it('replaces public notes while preserving durable changelog history on the next release', () => {
    const root = createProject('1.0.0-alpha.1')
    fs.writeFileSync(
      path.join(root, 'CHANGELOG.md'),
      updateAppChangelog(CHANGELOG, '1.0.0-alpha.1', '2026-09-01', [
        {
          area: 'sessions',
          audience: 'prerelease-users',
          body: 'First release note.',
          file: '.release/changes/first.md',
          impact: 'minor',
          milestone: 'v1',
        },
      ]),
    )
    fs.writeFileSync(path.join(root, '.release', 'release-notes.md'), 'old notes\n')
    writeIntent(root, 'second.md', undefined, 'Second release note.')

    prepareAppRelease(root, '1.0.0-alpha.2', '2026-09-02')

    const changelog = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8')
    expect(changelog.indexOf('Second release note.')).toBeLessThan(
      changelog.indexOf('First release note.'),
    )
    expect(fs.readFileSync(path.join(root, '.release', 'release-notes.md'), 'utf8')).toBe(
      '# OpenWaggle v1.0.0-alpha.2\n\n### Sessions\n\nSecond release note.\n',
    )
  })
})
