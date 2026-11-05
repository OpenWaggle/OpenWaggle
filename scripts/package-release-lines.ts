import { execFile as execFileCallback } from 'node:child_process'
import { promisify } from 'node:util'
import {
  compareSemver,
  packageReleaseLineViolations,
  PULL_REQUEST_TITLE_HASH,
  semverParts,
  type PackageReleaseLineState,
  type ReleaseCommit,
  type VersioningRules,
} from './package-release-version'
import { touchesPath } from './publishable-package-diff'

const execFile = promisify(execFileCallback)

/*
 * Reads what `package-release-version.ts` needs from git at one revision: Release Please's config, each
 * package's newest `<component>-v<version>` tag, the commits since it that touch the package, and the
 * published and pending docs. Everything is read from the revision, not the working tree.
 */

const CONFIG_PATH = 'release-please-config.json'
const MANIFEST_PATH = '.release-please-manifest.json'
const PUBLISHED_DOCS_ROOT = 'website/src/content/docs/packages'
const PENDING_DOCS_ROOT = 'website/src/content/package-docs-next'
const GIT_MAX_BUFFER_BYTES = 10 * 1024 * 1024
const COMMIT_FIELD_COUNT = 3
const COMMIT_SUBJECT_FIELD_OFFSET = 1
const COMMIT_BODY_FIELD_OFFSET = 2

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

async function pullRequestTitleCommit(options: PackageReleaseLineCheckOptions, packagePath: string) {
  const { base, prTitle } = options
  if (prTitle === undefined || prTitle.length === 0 || base === undefined) return []
  const touched = await touchesPath({
    base,
    cwd: options.cwd,
    fallbackBase: options.fallbackBase ?? base,
    path: `${packagePath}/`,
    to: options.to,
  })
  return touched ? [{ hash: PULL_REQUEST_TITLE_HASH, subject: prTitle, body: '' }] : []
}

/** One package's state at `to`, or the history problem that keeps it from being read. */
async function readPackageState(
  options: PackageReleaseLineCheckOptions,
  packagePath: string,
  component: string,
  manifestVersion: string | undefined,
): Promise<PackageReleaseLineState | string> {
  const slug = packagePath.replace(/^packages\//u, '')
  const releasedVersion = await latestReleasedVersion(options.cwd, component, options.to)
  if (releasedVersion === undefined && manifestVersion !== undefined) {
    return `no ${component}-v* tag is reachable from ${options.to}, though ${MANIFEST_PATH} records ${component} ${manifestVersion}. Run git fetch --tags.`
  }
  const history = releasedVersion === undefined
    ? []
    : await commitsTouching(options.cwd, `${component}-v${releasedVersion}..${options.to}`, packagePath)
  return {
    component,
    slug,
    releasedVersion,
    commits: [...history, ...(await pullRequestTitleCommit(options, packagePath))],
    publishedLines: await publishedLinesAt(options.cwd, options.to, slug),
    hasPendingDocs: await gitSucceeds(options.cwd, ['cat-file', '-e', `${options.to}:${PENDING_DOCS_ROOT}/${slug}/index.md`]),
  }
}

/** Reads Release Please's config, tags, commits and the docs tree at `to`, then applies the version rules. */
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
  const manifest = await readJsonAt(options.cwd, options.to, MANIFEST_PATH)
  const shallow = (await git(options.cwd, ['rev-parse', '--is-shallow-repository'])).trim() === 'true'
  const historyProblems = shallow
    ? ['the clone is shallow, so package tags and history are incomplete. Run git fetch --unshallow --tags.']
    : []

  const packages: PackageReleaseLineState[] = []
  for (const packagePath of Object.keys(configuredPackages)) {
    const packageConfig = objectField(configuredPackages, packagePath)
    if (packageConfig === undefined) continue
    const component = stringField(packageConfig, 'component') ?? packagePath.replace(/^packages\//u, '')
    const manifestVersion = manifest === undefined ? undefined : stringField(manifest, packagePath)
    const state = await readPackageState(options, packagePath, component, manifestVersion)
    if (typeof state === 'string') historyProblems.push(state)
    else packages.push(state)
  }

  const violations = packageReleaseLineViolations(packages, rules, stringField(config, 'initial-version'))
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
