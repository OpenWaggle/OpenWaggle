/**
 * The files a desktop app release PR writes, and the Git trees that hold them
 * (docs/release-and-versioning.md, "Release Notes"). A release PR's head is always `main` plus two
 * generated files: `package.json` with the new version and `CHANGELOG.md` with the version's
 * entry. The workflow writes those files itself, in commits that change nothing else so the
 * workflow token may push them, and verifies a release PR by building the expected tree again
 * from its base and comparing.
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Schema } from 'effect'
import {
  CHANGELOG_PATH,
  changelogEntryDate,
  prepareChangelog,
  type ReleaseCommit,
} from './app-release-notes'
import { manifestJsonSchema, ROOT_MANIFEST_PATH } from './app-release-promotion'

const JSON_INDENT = 2
const RELEASE_TAG_PATTERN = 'v*'
const RECORD_SEPARATOR = '\u001e'
const FIELD_SEPARATOR = '\u001f'
const REGULAR_FILE_MODE = '100644'
const ISO_DATE_LENGTH = 10
/** The files a release PR changes, sorted as `git diff --name-only` lists them. */
export const RELEASE_FILES: readonly string[] = [CHANGELOG_PATH, ROOT_MANIFEST_PATH]

/** Where Git runs: the repository directory and the environment (tests pass one without GIT_*). */
export interface GitContext {
  readonly cwd?: string
  readonly env?: NodeJS.ProcessEnv
}

export function expectedVersionOnlyManifest(baseManifestJson: string, version: string) {
  const manifest = Schema.decodeUnknownSync(manifestJsonSchema)(baseManifestJson)
  return `${JSON.stringify({ ...manifest, version }, null, JSON_INDENT)}\n`
}

function git(
  context: GitContext,
  args: readonly string[],
  options: { readonly env?: NodeJS.ProcessEnv; readonly input?: string } = {},
) {
  return execFileSync('git', args, {
    cwd: context.cwd,
    env: options.env ?? context.env ?? process.env,
    encoding: 'utf8',
    input: options.input,
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim()
}

function gitShow(context: GitContext, ref: string, filePath: string) {
  try {
    return execFileSync('git', ['show', `${ref}:${filePath}`], {
      cwd: context.cwd,
      env: context.env ?? process.env,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch {
    throw new Error(`${ref} has no ${filePath}.`)
  }
}

/** The newest app release tag reachable from `ref` (as the bump step finds it), or null. */
function previousReleaseTag(context: GitContext, ref: string) {
  try {
    return git(context, ['describe', '--tags', '--abbrev=0', '--match', RELEASE_TAG_PATTERN, ref])
  } catch {
    return null
  }
}

function commitsSince(context: GitContext, previousTag: string | null, ref: string) {
  const format = `--format=%H${FIELD_SEPARATOR}%s${FIELD_SEPARATOR}%b${RECORD_SEPARATOR}`
  const log = git(context, ['log', format, previousTag ? `${previousTag}..${ref}` : ref])
  return log.split(RECORD_SEPARATOR).flatMap((record) => {
    const [sha = '', subject = '', body = ''] = record.trim().split(FIELD_SEPARATOR)
    const commit: ReleaseCommit = { sha, subject, body }
    return sha === '' ? [] : [commit]
  })
}

interface ReleaseFilesInput extends GitContext {
  readonly baseRef: string
  readonly version: string
  /** `YYYY-MM-DD` for the entry heading. */
  readonly date: string
}

/** CHANGELOG.md as the release PR for `version` writes it on top of `baseRef`. */
export function releaseChangelog(input: ReleaseFilesInput) {
  const previousTag = previousReleaseTag(input, input.baseRef)
  return prepareChangelog({
    changelog: gitShow(input, input.baseRef, CHANGELOG_PATH),
    version: input.version,
    date: input.date,
    commits: commitsSince(input, previousTag, input.baseRef),
    previousTag,
  })
}

function treeWithFiles(context: GitContext, treeRef: string, files: ReadonlyMap<string, string>) {
  const indexDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'openwaggle-release-index-'))
  const env = {
    ...(context.env ?? process.env),
    GIT_INDEX_FILE: path.join(indexDirectory, 'index'),
  }
  try {
    git(context, ['read-tree', treeRef], { env })
    for (const [filePath, content] of files) {
      const blob = git(context, ['hash-object', '-w', '--stdin'], { input: content })
      const entry = `${REGULAR_FILE_MODE},${blob},${filePath}`
      git(context, ['update-index', '--add', '--cacheinfo', entry], { env })
    }
    return git(context, ['write-tree'], { env })
  } finally {
    fs.rmSync(indexDirectory, { recursive: true, force: true })
  }
}

function commitTree(
  context: GitContext,
  input: { readonly tree: string; readonly parents: readonly string[]; readonly message: string },
) {
  const parentArguments = input.parents.flatMap((parent) => ['-p', parent])
  return git(context, ['commit-tree', input.tree, ...parentArguments, '-m', input.message])
}

/** The Git tree of `baseRef` with the release files for `version`, written to the object store. */
export function releaseTree(input: ReleaseFilesInput) {
  const manifest = gitShow(input, input.baseRef, ROOT_MANIFEST_PATH)
  const files = new Map([
    [ROOT_MANIFEST_PATH, expectedVersionOnlyManifest(manifest, input.version)],
    [CHANGELOG_PATH, releaseChangelog(input)],
  ])
  return treeWithFiles(input, input.baseRef, files)
}

/**
 * A commit of `releaseTree` on top of `parents`. The parent is `baseRef` for a new release branch,
 * or the branch head that already contains `baseRef` when the files are written again, so the
 * commit only ever changes the release files.
 */
export function createReleaseCommit(
  input: ReleaseFilesInput & { readonly parents: readonly string[]; readonly message: string },
) {
  return commitTree(input, { ...input, tree: releaseTree(input) })
}

/**
 * A commit on `ontoRef` that takes `fromRef`'s release files. The workflow pushes it before GitHub
 * merges main into a release branch whose files main also changed (notes under `## [Unreleased]`,
 * a dependency in package.json): both sides then make the same change, so the merge cannot
 * conflict, and the release files are written again afterwards.
 */
export function restoreReleaseFilesCommit(
  input: GitContext & {
    readonly fromRef: string
    readonly ontoRef: string
    readonly message: string
  },
) {
  const files = new Map(
    RELEASE_FILES.map((filePath) => [filePath, gitShow(input, input.fromRef, filePath)]),
  )
  return commitTree(input, {
    tree: treeWithFiles(input, input.ontoRef, files),
    parents: [input.ontoRef],
    message: input.message,
  })
}

interface ReleaseTreeCheck extends GitContext {
  readonly baseRef: string
  readonly candidateRef: string
  readonly version: string
  /**
   * Main's head, for the looser check before the release files are written again: then any
   * CHANGELOG.md passes, as long as nothing else changes.
   */
  readonly releaseFilesOnly?: string
}

function changedPaths(input: ReleaseTreeCheck) {
  const range = `${input.baseRef}...${input.candidateRef}`
  return git(input, ['diff', '--name-only', '--no-renames', range]).split('\n').filter(Boolean)
}

/** package.json at `baseRef` and at every commit up to `mainRef` that changed it. */
function manifestsSince(input: ReleaseTreeCheck, mainRef: string) {
  const range = `${input.baseRef}..${mainRef}`
  const commits = git(input, ['rev-list', range, '--', ROOT_MANIFEST_PATH]).split('\n')
  return [input.baseRef, ...commits.filter(Boolean)].map((ref) =>
    gitShow(input, ref, ROOT_MANIFEST_PATH),
  )
}

/**
 * Problems when the candidate changes more than the release files: any other path, or package.json
 * beyond its version. CHANGELOG.md is not compared, because the workflow writes it again. Holds
 * for a version-only release branch from before CHANGELOG.md was generated, for a branch right
 * after GitHub merged main into it, and for one left at the commit that took main's release files
 * when the merge after it failed: its package.json is then main's from that run, which may be
 * older than `mainRef`'s.
 */
function releaseFilesOnlyProblems(
  input: ReleaseTreeCheck,
  mainRef: string,
  changed: readonly string[],
) {
  const other = changed.filter((changedPath) => !RELEASE_FILES.includes(changedPath))
  if (other.length > 0) {
    return [`A release PR changes only ${RELEASE_FILES.join(' and ')}, not ${other.join(', ')}.`]
  }
  const candidate = gitShow(input, input.candidateRef, ROOT_MANIFEST_PATH)
  const accepted = manifestsSince(input, mainRef).some(
    (manifest) =>
      candidate === manifest || candidate === expectedVersionOnlyManifest(manifest, input.version),
  )
  return accepted ? [] : [`${ROOT_MANIFEST_PATH} changes more than its version.`]
}

/**
 * Why `candidateRef` is not exactly the release PR for `version` on top of `baseRef`; empty when
 * it is. The entry date is taken from the candidate, which keeps the day the workflow last wrote
 * its files.
 */
export function releaseTreeProblems(input: ReleaseTreeCheck) {
  const changed = changedPaths(input)
  const mainRef = input.releaseFilesOnly
  if (mainRef) return releaseFilesOnlyProblems(input, mainRef, changed)
  if (changed.join('\n') !== RELEASE_FILES.join('\n')) {
    const actual = changed.join(', ') || 'nothing'
    return [`A release PR changes exactly ${RELEASE_FILES.join(' and ')}, not ${actual}.`]
  }
  const { version } = input
  const date = changelogEntryDate(gitShow(input, input.candidateRef, CHANGELOG_PATH), version)
  if (!date) return [`${CHANGELOG_PATH} has no "## [${version}] - YYYY-MM-DD" entry.`]
  const expected = releaseTree({ ...input, date })
  return git(input, ['rev-parse', `${input.candidateRef}^{tree}`]) === expected
    ? []
    : [
        `${ROOT_MANIFEST_PATH} or ${CHANGELOG_PATH} differs from what the release workflow writes for ${version}. The release PR's files are generated: write hand-written notes under "## [Unreleased]" on main.`,
      ]
}

/** Today's date in UTC, `YYYY-MM-DD`. */
export function releaseDate(now = new Date()) {
  return now.toISOString().slice(0, ISO_DATE_LENGTH)
}
