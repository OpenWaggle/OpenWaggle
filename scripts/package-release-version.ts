import { DefaultChangelogNotes } from 'release-please/build/src/changelog-notes/default.js'
import {
  type ConventionalCommit,
  parseConventionalCommits,
} from 'release-please/build/src/commit.js'
import type { Logger } from 'release-please/build/src/util/logger.js'
import { Version } from 'release-please/build/src/version.js'
import { DefaultVersioningStrategy } from 'release-please/build/src/versioning-strategies/default.js'
import { documentationVersionFromPackageVersion } from './package-documentation-model'
import type { PackageReleaseRules } from './package-release-rules'

/**
 * Release Please opens a package's next major.minor documentation line on its release branch by
 * promoting `website/src/content/package-docs-next/<package>/`, and fails when that pending source is
 * missing. That happens after merge, where only another pull request can fix it. This module predicts
 * the next version with the pinned Release Please runtime itself, so the pull request that makes a
 * package's next release open a new line is the one asked to add its pending docs.
 * `package-release-lines.ts` reads the git state it is applied to.
 */

const PUBLISHED_DOCS_ROOT = 'website/src/content/docs/packages'
const PENDING_DOCS_ROOT = 'website/src/content/package-docs-next'
const RELEASE_AS_NOTE = 'RELEASE AS'
const FEATURE_TYPES = new Set(['feat', 'feature'])
const discardLog: Logger['warn'] = () => undefined
const QUIET_LOGGER: Logger = {
  debug: discardLog,
  error: discardLog,
  info: discardLog,
  trace: discardLog,
  warn: discardLog,
}

export interface ReleaseCommit {
  readonly hash: string
  /** The full commit message: subject, a blank line, then the body, as Release Please reads it. */
  readonly message: string
}

export interface PackageReleaseLineState {
  readonly component: string
  readonly slug: string
  /** The released version: the manifest's, or the newest `<component>-v<version>` tag without one. */
  readonly releasedVersion: string | undefined
  /** Newest first, like Release Please: the pull request title, then the package's commits since the release. */
  readonly commits: readonly ReleaseCommit[]
  readonly rules: PackageReleaseRules
  /** Published lines, oldest first by major.minor. */
  readonly publishedLines: readonly string[]
  readonly hasPendingDocs: boolean
}

/** Stands in for a commit hash when the pull request title is counted as the squash commit. */
export const PULL_REQUEST_TITLE_HASH = 'pull-request-title'
const SHORT_HASH_LENGTH = 9
const MAX_LISTED_COMMITS = 3

export function parseReleaseCommits(commits: readonly ReleaseCommit[]) {
  return parseConventionalCommits(
    commits.map((commit) => ({ sha: commit.hash, message: commit.message, files: [] })),
    QUIET_LOGGER,
  )
}

function releaseAsNote(commit: ConventionalCommit) {
  return commit.notes.find((note) => note.title === RELEASE_AS_NOTE)?.text
}

function buildNewVersion(
  parsed: readonly ConventionalCommit[],
  releasedVersion: string | undefined,
  rules: PackageReleaseRules,
) {
  if (rules.releaseAs !== undefined) return Version.parse(rules.releaseAs)
  const releaseAs = parsed.map(releaseAsNote).find((text) => text !== undefined)
  if (releaseAs !== undefined) return Version.parse(releaseAs)
  if (releasedVersion === undefined) return Version.parse(rules.initialVersion)
  return new DefaultVersioningStrategy({
    bumpMinorPreMajor: rules.bumpMinorPreMajor,
    bumpPatchForMinorPreMajor: rules.bumpPatchForMinorPreMajor,
    logger: QUIET_LOGGER,
  }).bump(Version.parse(releasedVersion), [...parsed])
}

/**
 * The version Release Please proposes next, or `undefined` when it would not release the package.
 * This follows the pinned strategy's `buildReleasePullRequest`: no parsed commits means no release,
 * `release-as` config then a `Release-As:` note force the version, otherwise the versioning strategy
 * bumps the released version (or the initial version applies), and release notes with no user-facing
 * entry mean no release. Dependent bumps from the `node-workspace` plugin are patches, so they never
 * open a new line and are left out.
 */
export async function nextReleaseVersion(input: {
  readonly releasedVersion: string | undefined
  readonly commits: readonly ReleaseCommit[]
  readonly rules: PackageReleaseRules
  readonly component: string
}) {
  const parsed = parseReleaseCommits(input.commits)
  if (parsed.length === 0) return undefined
  const version = buildNewVersion(parsed, input.releasedVersion, input.rules).toString()
  const notes = await new DefaultChangelogNotes().buildNotes([...parsed], {
    owner: 'OpenWaggle',
    repository: 'OpenWaggle',
    version,
    currentTag: `${input.component}-v${version}`,
    ...(input.releasedVersion === undefined
      ? {}
      : { previousTag: `${input.component}-v${input.releasedVersion}` }),
    targetBranch: 'main',
    ...(input.rules.changelogSections === undefined
      ? {}
      : { changelogSections: [...input.rules.changelogSections] }),
  })
  // The strategy's `changelogEmpty`: notes that are only the version header have nothing to release.
  return notes.split('\n').length <= 1 ? undefined : version
}

function opensLine(commit: ConventionalCommit) {
  return commit.breaking || FEATURE_TYPES.has(commit.type) || releaseAsNote(commit) !== undefined
}

function describeCommit(commit: ReleaseCommit) {
  const subject = commit.message.split('\n', 1)[0] ?? ''
  return commit.hash === PULL_REQUEST_TITLE_HASH
    ? `the pull request title ${JSON.stringify(subject)}`
    : `${commit.hash.slice(0, SHORT_HASH_LENGTH)} ${JSON.stringify(subject)}`
}

function reasonFor(state: PackageReleaseLineState) {
  const openingHashes = new Set(
    parseReleaseCommits(state.commits)
      .filter(opensLine)
      .map((commit) => commit.sha),
  )
  const opening = state.commits.filter((commit) => openingHashes.has(commit.hash))
  if (opening.length === 0)
    return state.rules.releaseAs === undefined
      ? ''
      : ` because release-as is ${state.rules.releaseAs}`
  const listed = opening.slice(0, MAX_LISTED_COMMITS).map(describeCommit).join(', ')
  const more =
    opening.length > MAX_LISTED_COMMITS
      ? ` and ${String(opening.length - MAX_LISTED_COMMITS)} more`
      : ''
  return ` because of ${listed}${more}`
}

/** Packages whose next release opens a documentation line that has neither pending nor published docs. */
export async function packageReleaseLineViolations(packages: readonly PackageReleaseLineState[]) {
  const violations: string[] = []
  for (const state of packages) {
    const nextVersion = await nextReleaseVersion(state)
    if (nextVersion === undefined) continue
    const nextLine = documentationVersionFromPackageVersion(nextVersion)
    if (state.publishedLines.includes(nextLine) || state.hasPendingDocs) continue
    const startFrom = state.publishedLines.at(-1)
    violations.push(
      [
        `The next ${state.component} release is ${nextVersion}${reasonFor(state)}.`,
        `That opens documentation line ${nextLine}, and Release Please fails after merge unless pending docs exist in ${PENDING_DOCS_ROOT}/${state.slug}/${
          startFrom === undefined
            ? ''
            : ` (start from ${PUBLISHED_DOCS_ROOT}/${state.slug}/${startFrom}/)`
        }.`,
        'Add them in this pull request, or retitle or rebase it so the commit that opens the line does not land.',
        'Update your branch from main if main already has these docs.',
      ].join(' '),
    )
  }
  return violations
}
