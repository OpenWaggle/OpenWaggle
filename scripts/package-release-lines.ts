import { execFile as execFileCallback } from 'node:child_process'
import { promisify } from 'node:util'
import { documentationVersionFromPackageVersion } from './package-documentation-model'
import { touchesPath } from './publishable-package-diff'

const execFile = promisify(execFileCallback)

/**
 * Release Please opens a package's next major.minor documentation line on its release branch by
 * promoting `website/src/content/package-docs-next/<package>/`, and fails when that pending source is
 * missing. That happens after merge, where only another pull request can fix it. This module predicts
 * the next version Release Please will choose from the same Conventional Commits, so the pull request
 * that makes a package's next release open a new line is the one asked to add its pending docs.
 */

const CONFIG_PATH = 'release-please-config.json'
const MANIFEST_PATH = '.release-please-manifest.json'
const PUBLISHED_DOCS_ROOT = 'website/src/content/docs/packages'
const PENDING_DOCS_ROOT = 'website/src/content/package-docs-next'
const GIT_MAX_BUFFER_BYTES = 10 * 1024 * 1024
const COMMIT_FIELD_COUNT = 3
const COMMIT_SUBJECT_FIELD_OFFSET = 1
const COMMIT_BODY_FIELD_OFFSET = 2
const DEFAULT_INITIAL_VERSION = '0.1.0'
const FIRST_STABLE_MAJOR = 1
const SEMVER_MAJOR_GROUP = 1
const SEMVER_MINOR_GROUP = 2
const SEMVER_PATCH_GROUP = 3
const SEMVER_PRERELEASE_GROUP = 4
const HEADER_TYPE_GROUP = 1
const HEADER_BREAKING_GROUP = 2
const SEMVER_PATTERN = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/u
const HEADER_PATTERN = /^(\w+)(?:\([^()\r\n]+\))?(!)?: \S/u
const BREAKING_FOOTER_PATTERN = /^BREAKING[ -]CHANGE: \S/mu
const RELEASE_AS_FOOTER_PATTERN = /^Release-As: *(\S+)\s*$/imu
const PATCH_TYPES = new Set(['fix', 'perf', 'revert'])

export type ReleaseBump = 'none' | 'patch' | 'minor' | 'major'

export interface ReleaseCommit {
  readonly hash: string
  readonly subject: string
  readonly body: string
}

export interface VersioningRules {
  /** `bump-minor-pre-major`: before 1.0.0 a breaking change bumps the minor version. */
  readonly bumpMinorPreMajor: boolean
  /** `bump-patch-for-minor-pre-major`: before 1.0.0 a feature bumps only the patch version. */
  readonly bumpPatchForMinorPreMajor: boolean
}

export interface PackageReleaseLineState {
  readonly component: string
  readonly slug: string
  /** The last released version, from the package's newest `<component>-v<version>` tag. */
  readonly releasedVersion: string | undefined
  /** Commits since that tag that touch the package, and the pull request title when it does. */
  readonly commits: readonly ReleaseCommit[]
  readonly publishedLines: readonly string[]
  readonly hasPendingDocs: boolean
}

interface SemverParts {
  readonly major: number
  readonly minor: number
  readonly patch: number
  readonly prerelease: string | undefined
}

function semverParts(version: string): SemverParts | undefined {
  const match = SEMVER_PATTERN.exec(version)
  if (!match) return undefined
  return {
    major: Number(match[SEMVER_MAJOR_GROUP]),
    minor: Number(match[SEMVER_MINOR_GROUP]),
    patch: Number(match[SEMVER_PATCH_GROUP]),
    prerelease: match[SEMVER_PRERELEASE_GROUP],
  }
}

function compareSemver(left: SemverParts, right: SemverParts) {
  if (left.major !== right.major) return left.major - right.major
  if (left.minor !== right.minor) return left.minor - right.minor
  if (left.patch !== right.patch) return left.patch - right.patch
  if (left.prerelease === right.prerelease) return 0
  if (left.prerelease === undefined) return 1
  if (right.prerelease === undefined) return -1
  return left.prerelease.localeCompare(right.prerelease)
}

const BUMP_ORDER: readonly ReleaseBump[] = ['none', 'patch', 'minor', 'major']

function strongerBump(left: ReleaseBump, right: ReleaseBump) {
  return BUMP_ORDER.indexOf(right) > BUMP_ORDER.indexOf(left) ? right : left
}

/** The bump one commit asks for, read as Release Please's Conventional Commit parser reads it. */
export function conventionalCommitBump(commit: Pick<ReleaseCommit, 'subject' | 'body'>): ReleaseBump {
  const header = HEADER_PATTERN.exec(commit.subject)
  if (!header) return 'none'
  if (header[HEADER_BREAKING_GROUP] === '!' || BREAKING_FOOTER_PATTERN.test(commit.body)) return 'major'
  const type = header[HEADER_TYPE_GROUP] ?? ''
  if (type === 'feat') return 'minor'
  return PATCH_TYPES.has(type) ? 'patch' : 'none'
}

function releaseAsVersion(commits: readonly ReleaseCommit[]) {
  for (const commit of commits) {
    const version = RELEASE_AS_FOOTER_PATTERN.exec(commit.body)?.[1]
    if (version !== undefined && semverParts(version) !== undefined) return version
  }
  return undefined
}

/**
 * The version Release Please proposes next, with `release-type: node`'s default versioning: a
 * `Release-As:` footer wins, otherwise the strongest commit bump applies, softened before 1.0.0 by
 * the pre-major options. `undefined` means no release. Dependent bumps from the `node-workspace`
 * plugin are patches, so they never open a new line and are left out.
 */
export function nextReleaseVersion(input: {
  readonly releasedVersion: string | undefined
  readonly commits: readonly ReleaseCommit[]
  readonly rules: VersioningRules
  readonly initialVersion?: string
}) {
  const releaseAs = releaseAsVersion(input.commits)
  if (releaseAs !== undefined) return releaseAs
  if (input.releasedVersion === undefined) return input.initialVersion ?? DEFAULT_INITIAL_VERSION

  const current = semverParts(input.releasedVersion)
  if (current === undefined) throw new Error(`Invalid released package version: ${input.releasedVersion}`)
  const bump = input.commits.map(conventionalCommitBump).reduce(strongerBump, 'none')
  const preMajor = current.major < FIRST_STABLE_MAJOR
  const effective =
    bump === 'major' && preMajor && input.rules.bumpMinorPreMajor
      ? 'minor'
      : bump === 'minor' && preMajor && input.rules.bumpPatchForMinorPreMajor
        ? 'patch'
        : bump
  if (effective === 'none') return undefined
  if (effective === 'major') return `${String(current.major + 1)}.0.0`
  if (effective === 'minor') return `${String(current.major)}.${String(current.minor + 1)}.0`
  return `${String(current.major)}.${String(current.minor)}.${String(current.patch + 1)}`
}

const PULL_REQUEST_TITLE_HASH = 'pull-request-title'
const SHORT_HASH_LENGTH = 9
const MAX_LISTED_COMMITS = 3

function describeCommit(commit: ReleaseCommit) {
  return commit.hash === PULL_REQUEST_TITLE_HASH
    ? `the pull request title ${JSON.stringify(commit.subject)}`
    : `${commit.hash.slice(0, SHORT_HASH_LENGTH)} ${JSON.stringify(commit.subject)}`
}

/** Packages whose next release opens a documentation line that has neither pending nor published docs. */
export function packageReleaseLineViolations(
  packages: readonly PackageReleaseLineState[],
  rules: VersioningRules,
  initialVersion?: string,
) {
  return packages.flatMap((state) => {
    const nextVersion = nextReleaseVersion({
      releasedVersion: state.releasedVersion,
      commits: state.commits,
      rules,
      ...(initialVersion === undefined ? {} : { initialVersion }),
    })
    if (nextVersion === undefined) return []
    const nextLine = documentationVersionFromPackageVersion(nextVersion)
    if (state.publishedLines.includes(nextLine) || state.hasPendingDocs) return []
    const opening = state.commits.filter((commit) => {
      const bump = conventionalCommitBump(commit)
      return bump === 'minor' || bump === 'major'
    })
    const reason = opening.length === 0
      ? ''
      : ` because of ${opening.slice(0, MAX_LISTED_COMMITS).map(describeCommit).join(', ')}${
          opening.length > MAX_LISTED_COMMITS ? ` and ${String(opening.length - MAX_LISTED_COMMITS)} more` : ''
        }`
    return [
      `The next ${state.component} release is ${nextVersion}${reason}. It opens documentation line ${nextLine}, so Release Please needs pending docs in ${PENDING_DOCS_ROOT}/${state.slug}/ (start from ${PUBLISHED_DOCS_ROOT}/${state.slug}/${state.publishedLines.at(-1) ?? nextLine}/).`,
    ]
  })
}

async function git(cwd: string, args: readonly string[]) {
  const { stdout } = await execFile('git', args, { cwd, maxBuffer: GIT_MAX_BUFFER_BYTES })
  return stdout
}

async function gitSucceeds(cwd: string, args: readonly string[]) {
  try {
    await git(cwd, args)
    return true
  } catch {
    return false
  }
}

async function readJsonAt(cwd: string, revision: string, filePath: string) {
  try {
    const parsed: unknown = JSON.parse(await git(cwd, ['show', `${revision}:${filePath}`]))
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

function stringField(value: object, key: string) {
  const field: unknown = Reflect.get(value, key)
  return typeof field === 'string' ? field : undefined
}

function objectField(value: object, key: string) {
  const field: unknown = Reflect.get(value, key)
  return typeof field === 'object' && field !== null && !Array.isArray(field) ? field : undefined
}

async function latestReleasedVersion(cwd: string, component: string, to: string) {
  const tags = (await git(cwd, ['tag', '--list', `${component}-v*`, '--merged', to]))
    .split('\n')
    .map((tag) => tag.trim().slice(`${component}-v`.length))
    .flatMap((version) => {
      const parts = semverParts(version)
      return parts === undefined ? [] : [{ parts, version }]
    })
    .sort((left, right) => compareSemver(left.parts, right.parts))
  return tags.at(-1)?.version
}

async function commitsTouching(cwd: string, range: string, packagePath: string) {
  const fields = (
    await git(cwd, ['log', '--format=%H%x00%s%x00%b%x00', range, '--', `${packagePath}/`])
  ).split('\0')
  const commits: ReleaseCommit[] = []
  for (let index = 0; index + COMMIT_BODY_FIELD_OFFSET < fields.length; index += COMMIT_FIELD_COUNT) {
    const hash = fields[index]?.trim() ?? ''
    if (hash.length === 0) continue
    commits.push({
      hash,
      subject: fields[index + COMMIT_SUBJECT_FIELD_OFFSET] ?? '',
      body: fields[index + COMMIT_BODY_FIELD_OFFSET] ?? '',
    })
  }
  return commits
}

async function publishedLinesAt(cwd: string, to: string, slug: string) {
  try {
    return (await git(cwd, ['ls-tree', '-d', '--name-only', `${to}:${PUBLISHED_DOCS_ROOT}/${slug}`]))
      .split('\n')
      .map((entry) => entry.trim())
      .filter((entry) => /^\d+\.\d+$/u.test(entry))
  } catch {
    return []
  }
}

export interface PackageReleaseLineCheckOptions {
  readonly cwd: string
  readonly to: string
  /** The pull request base. With `prTitle`, the title counts for every package the pull request touches. */
  readonly base?: string
  readonly fallbackBase?: string
  readonly prTitle?: string
  /**
   * What to do when a released package has no reachable tag or the clone is shallow: `fail` in CI,
   * where the Commit Policy job fetches full history and tags, `skip` for local pre-push checks.
   */
  readonly missingHistory: 'fail' | 'skip'
}

export interface PackageReleaseLineCheckResult {
  readonly packages: readonly PackageReleaseLineState[]
  readonly skipped: readonly string[]
  readonly violations: readonly string[]
}

/** Reads Release Please's config, tags, commits and the docs tree at `to`, then applies the rules above. */
export async function checkPackageReleaseLines(
  options: PackageReleaseLineCheckOptions,
): Promise<PackageReleaseLineCheckResult> {
  const config = await readJsonAt(options.cwd, options.to, CONFIG_PATH)
  const configuredPackages = config === undefined ? undefined : objectField(config, 'packages')
  if (config === undefined || configuredPackages === undefined) {
    return { packages: [], skipped: [], violations: [] }
  }
  const rules: VersioningRules = {
    bumpMinorPreMajor: Reflect.get(config, 'bump-minor-pre-major') === true,
    bumpPatchForMinorPreMajor: Reflect.get(config, 'bump-patch-for-minor-pre-major') === true,
  }
  const initialVersion = stringField(config, 'initial-version')
  const manifest = await readJsonAt(options.cwd, options.to, MANIFEST_PATH)
  const shallow = (await git(options.cwd, ['rev-parse', '--is-shallow-repository'])).trim() === 'true'
  const historyProblems: string[] = []
  if (shallow) {
    historyProblems.push('the clone is shallow, so package tags and history are incomplete. Run git fetch --unshallow --tags.')
  }

  const packages: PackageReleaseLineState[] = []
  for (const [packagePath, packageConfig] of Object.entries(configuredPackages)) {
    if (typeof packageConfig !== 'object' || packageConfig === null) continue
    const slug = packagePath.replace(/^packages\//u, '')
    const component = stringField(packageConfig, 'component') ?? slug
    const releasedVersion = await latestReleasedVersion(options.cwd, component, options.to)
    const manifestVersion = manifest === undefined ? undefined : stringField(manifest, packagePath)
    if (releasedVersion === undefined && manifestVersion !== undefined) {
      historyProblems.push(
        `no ${component}-v* tag is reachable from ${options.to}, though ${MANIFEST_PATH} records ${component} ${manifestVersion}. Run git fetch --tags.`,
      )
      continue
    }
    const commits = releasedVersion === undefined
      ? []
      : await commitsTouching(options.cwd, `${component}-v${releasedVersion}..${options.to}`, packagePath)
    if (
      options.prTitle !== undefined &&
      options.prTitle.length > 0 &&
      options.base !== undefined &&
      (await touchesPath({
        base: options.base,
        cwd: options.cwd,
        fallbackBase: options.fallbackBase ?? options.base,
        path: `${packagePath}/`,
        to: options.to,
      }))
    ) {
      commits.push({ hash: PULL_REQUEST_TITLE_HASH, subject: options.prTitle, body: '' })
    }
    packages.push({
      component,
      slug,
      releasedVersion,
      commits,
      publishedLines: await publishedLinesAt(options.cwd, options.to, slug),
      hasPendingDocs: await gitSucceeds(options.cwd, [
        'cat-file',
        '-e',
        `${options.to}:${PENDING_DOCS_ROOT}/${slug}/index.md`,
      ]),
    })
  }

  const violations = packageReleaseLineViolations(packages, rules, initialVersion)
  if (historyProblems.length === 0) return { packages, skipped: [], violations }
  if (options.missingHistory === 'skip') return { packages, skipped: historyProblems, violations }
  return {
    packages,
    skipped: [],
    violations: [
      ...historyProblems.map((problem) => `Cannot predict package documentation lines: ${problem}`),
      ...violations,
    ],
  }
}
