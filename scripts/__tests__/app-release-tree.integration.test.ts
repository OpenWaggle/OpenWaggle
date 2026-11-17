import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { changelogEntry, unreleasedNotes } from '../app-release-notes'
import {
  createReleaseCommit,
  releaseChangelog,
  releaseTreeProblems,
  restoreReleaseFilesCommit,
} from '../app-release-tree'
import { gitRunner, isolatedGitEnv } from './app-release-files.test-harness'

const VERSION = '1.0.0-beta.2'
const DATE = '2026-11-18'
const MANIFEST = `${JSON.stringify({ name: 'fixture', version: '1.0.0-beta.1' }, null, 2)}\n`
const CHANGELOG = '# Changelog\n\n## [Unreleased]\n\n### Highlights\n\n- For Stable.\n'

const env = isolatedGitEnv()
const git = gitRunner(env)
let repository = ''

async function commit(files: Record<string, string>, subject: string) {
  for (const [filePath, content] of Object.entries(files)) {
    await fs.writeFile(path.join(repository, filePath), content)
  }
  await git(repository, 'add', '.')
  await git(repository, 'commit', '-m', subject)
  return git(repository, 'rev-parse', 'HEAD')
}

function releaseCommit(baseRef: string, parents: readonly string[], date = DATE) {
  return createReleaseCommit({
    cwd: repository,
    env,
    baseRef,
    version: VERSION,
    date,
    parents,
    message: `chore(release): v${VERSION}`,
  })
}

function problems(baseRef: string, candidateRef: string, releaseFilesOnly?: string) {
  return releaseTreeProblems({
    cwd: repository,
    env,
    baseRef,
    candidateRef,
    version: VERSION,
    ...(releaseFilesOnly === undefined ? {} : { releaseFilesOnly }),
  })
}

beforeEach(async () => {
  repository = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-release-tree-'))
  await git(repository, 'init', '--initial-branch=main')
  await commit({ 'package.json': MANIFEST, 'CHANGELOG.md': CHANGELOG }, 'feat: initial app')
  await git(repository, 'tag', '-a', 'v1.0.0-beta.1', '-m', 'Release v1.0.0-beta.1')
})

afterEach(async () => {
  await fs.rm(repository, { recursive: true, force: true })
})

describe('desktop app release files', () => {
  it('writes the entry from the commits since the previous release tag', async () => {
    await commit({ 'app.ts': 'export {}\n' }, 'fix(sessions): keep the queue (#12)')
    const main = await commit({ 'guide.md': '# Guide\n' }, 'docs: a guide (#13)')

    const changelog = releaseChangelog({
      cwd: repository,
      env,
      baseRef: main,
      version: VERSION,
      date: DATE,
    })

    expect(changelogEntry(changelog, VERSION)).toBe(
      '### Fixes\n\n- **sessions:** keep the queue ([#12](https://github.com/OpenWaggle/OpenWaggle/pull/12))',
    )
    expect(unreleasedNotes(changelog)).toBe('### Highlights\n\n- For Stable.')
  })

  it('commits only the release files on top of main, and verifies exactly that tree', async () => {
    const main = await commit({ 'app.ts': 'export {}\n' }, 'feat: a feature (#14)')
    const release = releaseCommit(main, [main])

    expect(await git(repository, 'diff', '--name-only', main, release)).toBe(
      'CHANGELOG.md\npackage.json',
    )
    expect(await git(repository, 'show', `${release}:package.json`)).toContain(
      `"version": "${VERSION}"`,
    )
    expect(problems(main, release)).toEqual([])
    // A later day's run accepts the date the PR already has.
    expect(problems(main, releaseCommit(main, [main], '2026-11-20'))).toEqual([])
  })

  it('rejects a hand-edited entry, a stale entry and any other change', async () => {
    const main = await commit({ 'app.ts': 'export {}\n' }, 'feat: a feature (#14)')
    const release = releaseCommit(main, [main])
    await git(repository, 'switch', '--quiet', '--detach', release)
    const changelog = await fs.readFile(path.join(repository, 'CHANGELOG.md'), 'utf8')
    const edited = await commit(
      { 'CHANGELOG.md': changelog.replace('a feature', 'an edited feature') },
      'chore: edit the entry',
    )
    const extra = await commit({ 'other.txt': 'x\n' }, 'chore: another file')
    await git(repository, 'switch', '--quiet', 'main')
    const newerMain = await commit({ 'app.ts': 'export const a = 1\n' }, 'fix: newer (#15)')

    expect(problems(main, edited)[0]).toContain('differs from what the release workflow writes')
    expect(problems(main, extra)[0]).toContain('not CHANGELOG.md, other.txt, package.json')
    expect(problems(main, main)[0]).toContain('not nothing')
    // The entry lists commits up to `main`, so it is stale for newerMain.
    const resynced = releaseCommit(newerMain, [newerMain])
    expect(problems(newerMain, resynced)).toEqual([])
    expect(problems(main, extra, main)).toEqual([
      'A release PR changes only CHANGELOG.md and package.json, not other.txt.',
    ])
  })

  it('accepts a version-only branch from before CHANGELOG.md was generated only before a sync', async () => {
    const main = await git(repository, 'rev-parse', 'HEAD')
    const versionOnly = await commit(
      { 'package.json': MANIFEST.replace('1.0.0-beta.1', VERSION) },
      `chore(release): v${VERSION}`,
    )
    const tampered = await commit(
      { 'package.json': MANIFEST.replace('1.0.0-beta.1', VERSION).replace('fixture', 'other') },
      'chore: rename',
    )

    expect(problems(main, versionOnly, main)).toEqual([])
    expect(problems(main, versionOnly)[0]).toContain('not package.json')
    expect(problems(main, tampered, main)).toEqual(['package.json changes more than its version.'])
  })

  it("accepts a branch left at the commit that took an older main's release files", async () => {
    const base = await git(repository, 'rev-parse', 'HEAD')
    const release = releaseCommit(base, [base])
    const dependency = (name: string) =>
      `${JSON.stringify({ name: 'fixture', version: '1.0.0-beta.1', dependencies: { [name]: '1' } }, null, 2)}\n`
    const syncedMain = await commit({ 'package.json': dependency('a') }, 'fix(deps): add a (#16)')
    const restored = restoreReleaseFilesCommit({
      cwd: repository,
      env,
      fromRef: syncedMain,
      ontoRef: release,
      message: 'chore(release): take main files',
    })
    // GitHub's merge failed, and main changed package.json again before the next run.
    const newerMain = await commit({ 'package.json': dependency('b') }, 'fix(deps): add b (#17)')

    expect(problems(base, restored, newerMain)).toEqual([])
    expect(problems(base, restored, base)).toEqual(['package.json changes more than its version.'])
  })

  it("takes main's release files onto a release branch, changing nothing else", async () => {
    const base = await git(repository, 'rev-parse', 'HEAD')
    const release = releaseCommit(base, [base])
    const notes = `${CHANGELOG}- More.\n`
    const main = await commit({ 'CHANGELOG.md': notes, 'app.ts': 'export {}\n' }, 'docs: notes')

    const restored = restoreReleaseFilesCommit({
      cwd: repository,
      env,
      fromRef: main,
      ontoRef: release,
      message: 'chore(release): take main files',
    })

    expect(await git(repository, 'diff', '--name-only', release, restored)).toBe(
      'CHANGELOG.md\npackage.json',
    )
    expect(await git(repository, 'show', `${restored}:CHANGELOG.md`)).toBe(notes.trim())
    expect(await git(repository, 'show', `${restored}:package.json`)).toBe(MANIFEST.trim())
  })
})
