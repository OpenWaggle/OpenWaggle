import {
  commitsTouching,
  gitSucceeds,
  git,
  manifestChangeCommit,
  objectField,
  parseVersion,
  publishedLinesAt,
  readJsonAt,
  releasedTagVersions,
  stringField,
} from './package-release-git'
import { packageReleaseRules } from './package-release-rules'
import {
  packageReleaseLineViolations,
  PULL_REQUEST_TITLE_HASH,
  type PackageReleaseLineState,
  type ReleaseCommit,
} from './package-release-version'
import { touchesPath } from './publishable-package-diff'

/*
 * Reads what `package-release-version.ts` needs from git at one revision: Release Please's config and
 * manifest, each package's released version and the commits since that release that touch the
 * package, and the published and pending docs. Everything is read from the revision, not the working tree.
 */

const CONFIG_PATH = 'release-please-config.json'
const MANIFEST_PATH = '.release-please-manifest.json'
const PUBLISHED_DOCS_ROOT = 'website/src/content/docs/packages'
const PENDING_DOCS_ROOT = 'website/src/content/package-docs-next'

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

async function pullRequestTitleCommit(
  options: PackageReleaseLineCheckOptions,
  packagePath: string,
) {
  const { base, prTitle } = options
  if (prTitle === undefined || prTitle.length === 0 || base === undefined) return []
  const touched = await touchesPath({
    base,
    cwd: options.cwd,
    fallbackBase: options.fallbackBase ?? base,
    path: `${packagePath}/`,
    to: options.to,
  })
  return touched ? [{ hash: PULL_REQUEST_TITLE_HASH, message: prTitle }] : []
}

interface ReleasedState {
  readonly releasedVersion: string | undefined
  /** Where the package's unreleased history starts: its release tag or the release commit; none if never released. */
  readonly since: string | undefined
}

/**
 * The package's released version and where its unreleased commits start. Release Please treats the
 * manifest as the released version and finds that version's tag. Tags are only created after npm
 * publish, so between a release pull request merging and promotion finishing the manifest is ahead of
 * the newest tag. Then the release commit that recorded the manifest version starts the range.
 */
async function releasedState(
  options: PackageReleaseLineCheckOptions,
  packagePath: string,
  component: string,
  manifestVersion: string | undefined,
): Promise<ReleasedState | string> {
  const tags = await releasedTagVersions(options.cwd, component, options.to)
  const newestTag = tags.at(-1)?.toString()
  if (manifestVersion === undefined) {
    return {
      releasedVersion: newestTag,
      since: newestTag === undefined ? undefined : `${component}-v${newestTag}`,
    }
  }
  const manifest = parseVersion(manifestVersion)
  if (manifest === undefined)
    return `${MANIFEST_PATH} records an invalid ${component} version ${JSON.stringify(manifestVersion)}.`
  if (tags.some((tag) => tag.compare(manifest) === 0)) {
    return { releasedVersion: manifestVersion, since: `${component}-v${manifestVersion}` }
  }
  if (newestTag === undefined) {
    return `no ${component}-v* tag is reachable from ${options.to}, though ${MANIFEST_PATH} records ${component} ${manifestVersion}. Run git fetch --tags.`
  }
  if ((tags.at(-1)?.compare(manifest) ?? 0) > 0) {
    return `the newest ${component} tag ${component}-v${newestTag} is newer than ${MANIFEST_PATH}'s ${manifestVersion}.`
  }
  const releaseCommit = await manifestChangeCommit(
    options.cwd,
    options.to,
    MANIFEST_PATH,
    packagePath,
    manifestVersion,
  )
  if (releaseCommit === undefined) {
    return `no commit reachable from ${options.to} recorded ${component} ${manifestVersion} in ${MANIFEST_PATH}.`
  }
  return { releasedVersion: manifestVersion, since: releaseCommit }
}

/** One package's state at `to`, or the history or config problem that keeps it from being read. */
async function readPackageState(
  options: PackageReleaseLineCheckOptions,
  packagePath: string,
  packageConfig: object,
  config: object,
  manifestVersion: string | undefined,
): Promise<
  PackageReleaseLineState | { readonly problem: string; readonly kind: 'history' | 'config' }
> {
  const slug = packagePath.replace(/^packages\//u, '')
  const component = stringField(packageConfig, 'component') ?? slug
  const rules = packageReleaseRules(packageConfig, config)
  if (typeof rules === 'string') {
    return {
      kind: 'config',
      problem: `${CONFIG_PATH} gives ${packagePath} ${rules}, so its next version cannot be predicted. Teach scripts/package-release-rules.ts that setting first.`,
    }
  }
  const released = await releasedState(options, packagePath, component, manifestVersion)
  if (typeof released === 'string') return { kind: 'history', problem: released }
  const range = released.since === undefined ? options.to : `${released.since}..${options.to}`
  const history: ReleaseCommit[] = await commitsTouching(options.cwd, range, packagePath)
  return {
    component,
    slug,
    releasedVersion: released.releasedVersion,
    // Newest first, as Release Please reads them: the title stands for the squash commit on top.
    commits: [...(await pullRequestTitleCommit(options, packagePath)), ...history],
    rules,
    publishedLines: await publishedLinesAt(
      options.cwd,
      options.to,
      `${PUBLISHED_DOCS_ROOT}/${slug}`,
    ),
    hasPendingDocs: await gitSucceeds(options.cwd, [
      'cat-file',
      '-e',
      `${options.to}:${PENDING_DOCS_ROOT}/${slug}/index.md`,
    ]),
  }
}

/** Reads Release Please's config, tags, commits and the docs tree at `to`, then applies the version rules. */
export async function checkPackageReleaseLines(
  options: PackageReleaseLineCheckOptions,
): Promise<PackageReleaseLineCheckResult> {
  const config = await readJsonAt(options.cwd, options.to, CONFIG_PATH)
  const configuredPackages = config === undefined ? undefined : objectField(config, 'packages')
  if (config === undefined || configuredPackages === undefined) {
    // No config means no Release Please packages. A config that exists but cannot be read must not
    // silently turn the check off.
    const configExists = await gitSucceeds(options.cwd, [
      'cat-file',
      '-e',
      `${options.to}:${CONFIG_PATH}`,
    ])
    const violations = configExists
      ? [
          `Cannot predict package documentation lines: ${CONFIG_PATH} is not valid JSON with a packages object.`,
        ]
      : []
    return { packages: [], skipped: [], violations }
  }
  const manifest = await readJsonAt(options.cwd, options.to, MANIFEST_PATH)
  const shallow =
    (await git(options.cwd, ['rev-parse', '--is-shallow-repository'])).trim() === 'true'
  const historyProblems = shallow
    ? [
        'the clone is shallow, so package tags and history are incomplete. Run git fetch --unshallow --tags.',
      ]
    : []
  const configProblems: string[] = []

  const packages: PackageReleaseLineState[] = []
  for (const packagePath of Object.keys(configuredPackages)) {
    const packageConfig = objectField(configuredPackages, packagePath)
    if (packageConfig === undefined) {
      configProblems.push(`the ${CONFIG_PATH} entry for ${packagePath} is not an object.`)
      continue
    }
    const manifestVersion = manifest === undefined ? undefined : stringField(manifest, packagePath)
    const state = await readPackageState(
      options,
      packagePath,
      packageConfig,
      config,
      manifestVersion,
    )
    if ('problem' in state)
      (state.kind === 'config' ? configProblems : historyProblems).push(state.problem)
    else packages.push(state)
  }

  const violations = [
    ...configProblems.map((problem) => `Cannot predict package documentation lines: ${problem}`),
    ...(await packageReleaseLineViolations(packages)),
  ]
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
