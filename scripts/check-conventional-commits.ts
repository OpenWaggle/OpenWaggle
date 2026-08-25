import { execFile as execFileCallback } from 'node:child_process'
import { promisify } from 'node:util'
import { isAncestor } from './git-ancestry'
import { collectUpstreamUpdateMergeHashes } from './upstream-merge-attribution'
import { touchesPublishablePackage } from './publishable-package-diff'

const execFile = promisify(execFileCallback)

const ALL_ZERO_SHA_PATTERN = /^0+$/
const CLI_ARGUMENT_START_INDEX = 2
const CONVENTIONAL_COMMIT_SUBJECT_PATTERN =
  /^(?:feat|fix|docs|test|chore|refactor|perf|ci|build|revert)(?:\([^()\r\n]+\))?!?: \S.*$/
const PACKAGE_RELEASE_INTENT_PATTERN =
  /^(?:(?:feat|fix|revert)(?:\([^()\r\n]+\))?!?: \S.*|chore\(main\): release \S.*)$/
const COMMIT_BODY_FIELD_OFFSET = 3
const COMMIT_FIELD_COUNT = 4
const COMMIT_PARENTS_FIELD_OFFSET = 1
const COMMIT_SUBJECT_FIELD_OFFSET = 2
const GIT_LOG_MAX_BUFFER_BYTES = 10 * 1024 * 1024
const POLICY_SCRIPT_PATH = 'scripts/check-conventional-commits.ts'

export interface CommitSubject {
  readonly body: string
  readonly changedPaths: readonly string[]
  readonly hash: string
  readonly parentHashes: readonly string[]
  readonly subject: string
}

export interface ConventionalCommitValidationOptions {
  readonly baseline?: string
  readonly cwd?: string
  readonly from?: string
  readonly prTitle?: string
  readonly to?: string
}

export function hasPackageReleaseIntent(title: string) {
  return PACKAGE_RELEASE_INTENT_PATTERN.test(title)
}

/** The published npm surface. */
const PUBLISHABLE_PATH_PREFIX = 'packages/'

function affectsPublishablePackage(commit: CommitSubject) {
  return commit.changedPaths.some((changedPath) =>
    changedPath.startsWith(PUBLISHABLE_PATH_PREFIX),
  )
}

function isGeneratedNonPackageMerge(commit: CommitSubject) {
  return (
    commit.parentHashes.length > 1 &&
    commit.subject.startsWith('Merge ') &&
    !affectsPublishablePackage(commit)
  )
}

/**
 * An update-branch merge that only brings work already present on the base branch.
 *
 * The package rule exists so a merge cannot introduce package changes without a Release
 * Please bump. That reasoning applies to merging a feature branch *into* the base, where
 * the changes are new. It does not apply in the other direction: when the base branch is
 * merged *into* a feature branch, any package changes it carries are already on the base
 * with whatever release commits accompanied them, so this pull request owes no bump for
 * them. Attributing them to the merge made every branch that syncs with a base branch that
 * touched `packages/` fail the policy, which is a false positive rather than a caught risk.
 *
 * Narrow by construction: the exemption applies only when *every* incoming parent is
 * already contained in the base, so a merge that also brings unreleased work is still
 * judged on its changed paths.
 */
function isUpstreamUpdateMerge(commit: CommitSubject, upstreamMergeHashes: ReadonlySet<string>) {
  return (
    commit.parentHashes.length > 1 &&
    commit.subject.startsWith('Merge ') &&
    upstreamMergeHashes.has(commit.hash)
  )
}

export function validateConventionalCommitSubjects(
  commits: readonly CommitSubject[],
  upstreamMergeHashes: ReadonlySet<string> = new Set<string>(),
) {
  return commits.flatMap((commit) => {
    if (isGeneratedNonPackageMerge(commit)) {
      return []
    }

    if (isUpstreamUpdateMerge(commit, upstreamMergeHashes)) {
      return []
    }

    if (
      commit.parentHashes.length > 1 &&
      commit.subject.startsWith('Merge ') &&
      affectsPublishablePackage(commit)
    ) {
      return [
        `${commit.hash}: ${JSON.stringify(commit.subject)} affects a publishable package and must carry explicit Conventional Commit release intent.`,
      ]
    }

    return CONVENTIONAL_COMMIT_SUBJECT_PATTERN.test(commit.subject)
      ? []
      : [
          `${commit.hash}: ${JSON.stringify(commit.subject)} is not an allowed Conventional Commit subject.`,
        ]
  })
}

async function resolveBaseline(input: {
  readonly cwd: string
  readonly options: ConventionalCommitValidationOptions
  readonly to: string
}) {
  const explicitBaseline = input.options.baseline ?? process.env.OPENWAGGLE_COMMIT_POLICY_BASELINE
  if (explicitBaseline !== undefined && explicitBaseline.length > 0) {
    return explicitBaseline
  }

  const { stdout } = await execFile(
    'git',
    ['log', '--diff-filter=A', '--format=%H', '--reverse', input.to, '--', POLICY_SCRIPT_PATH],
    { cwd: input.cwd, maxBuffer: GIT_LOG_MAX_BUFFER_BYTES },
  )
  const activationCommit = stdout.split('\n').find((commit) => commit.length > 0)

  return activationCommit ?? input.to
}

function resolveFrom(options: ConventionalCommitValidationOptions, baseline: string) {
  return options.from === undefined || options.from.length === 0 || ALL_ZERO_SHA_PATTERN.test(options.from)
    ? baseline
    : options.from
}

async function resolveEffectiveFrom(input: {
  readonly baseline: string
  readonly cwd: string
  readonly from: string
  readonly to: string
}) {
  if (!(await isAncestor(input.cwd, input.baseline, input.to))) {
    throw new Error(
      `Bootstrap baseline ${input.baseline} is not an ancestor of ${input.to}; refusing to validate pre-baseline history.`,
    )
  }

  if (
    input.from === input.baseline ||
    !(await isAncestor(input.cwd, input.from, input.to)) ||
    (await isAncestor(input.cwd, input.from, input.baseline))
  ) {
    return input.baseline
  }

  return input.from
}

async function readCommitSubjects(cwd: string, from: string, to: string) {
  const { stdout } = await execFile(
    'git',
    ['log', '--format=%H%x00%P%x00%s%x00%b%x00', `${from}..${to}`],
    { cwd, maxBuffer: GIT_LOG_MAX_BUFFER_BYTES },
  )
  const fields = stdout.split('\0')
  const commits: CommitSubject[] = []

  for (let index = 0; index + COMMIT_BODY_FIELD_OFFSET < fields.length; index += COMMIT_FIELD_COUNT) {
    const hash = fields[index]
    const parents = fields[index + COMMIT_PARENTS_FIELD_OFFSET]
    const subject = fields[index + COMMIT_SUBJECT_FIELD_OFFSET]
    const body = fields[index + COMMIT_BODY_FIELD_OFFSET]

    if (
      hash === undefined ||
      parents === undefined ||
      subject === undefined ||
      body === undefined ||
      hash.length === 0
    ) {
      continue
    }

    const normalizedHash = hash.trim()
    const parentHashes = parents.trim().split(' ').filter((parentHash) => parentHash.length > 0)
    const firstParent = parentHashes[0]
    const changedPathsArgs =
      parentHashes.length > 1 && firstParent !== undefined
        ? ['diff', '--no-renames', '--name-only', '-z', firstParent, normalizedHash]
        : [
            'diff-tree',
            '--no-commit-id',
            '--no-renames',
            '--name-only',
            '--root',
            '-r',
            '-z',
            normalizedHash,
          ]
    const { stdout: changedPathsOutput } = await execFile(
      'git',
      changedPathsArgs,
      { cwd, maxBuffer: GIT_LOG_MAX_BUFFER_BYTES },
    )

    commits.push({
      body,
      changedPaths: [...new Set(changedPathsOutput.split('\0').filter((entry) => entry.length > 0))],
      hash: normalizedHash,
      parentHashes,
      subject,
    })
  }

  return commits
}

/**
 * Merges in the range whose incoming parents are all already contained in the base ref.
 * See {@link isUpstreamUpdateMerge} for why those are exempt from the package rule.
 */
export async function validateConventionalCommits(options: ConventionalCommitValidationOptions = {}) {
  const cwd = options.cwd ?? process.cwd()
  const to = options.to ?? 'HEAD'
  const baseline = await resolveBaseline({ cwd, options, to })
  const from = resolveFrom(options, baseline)
  const effectiveFrom = await resolveEffectiveFrom({ baseline, cwd, from, to })
  const commits = await readCommitSubjects(cwd, effectiveFrom, to)
  const upstreamMergeHashes = await collectUpstreamUpdateMergeHashes({
    /*
     * The requested base ref first: in CI that is the base branch's current tip, which is the ref
     * the containment question is actually about. `effectiveFrom` is only the start of the range
     * being validated, and it collapses to the bootstrap baseline whenever the base has moved on.
     */
    bases: [from, effectiveFrom],
    commits,
    cwd,
  })

  const prTitleViolations =
    options.prTitle === undefined || options.prTitle.length === 0
      ? []
      : CONVENTIONAL_COMMIT_SUBJECT_PATTERN.test(options.prTitle)
        ? []
        : [
            `Pull request title "${options.prTitle}" is not an allowed Conventional Commit subject.`,
          ]

  /*
   * The same exemption as the commit-level rule: a sync merge of an already-released base branch
   * carries `packages/` paths relative to its first parent, but those changes are already on the
   * base with their own release commits, so this PR owes no version bump for them. Without this the
   * exemption only half worked - the merge commit passed while the PR *title* was still required to
   * carry release intent for changes that were never this PR's.
   */
  const ownedPackageChanges = commits.filter(
    (commit) => !isUpstreamUpdateMerge(commit, upstreamMergeHashes),
  )
  /*
   * Release intent is a question about the whole PR, asked against the base branch.
   *
   * Per-commit attribution cannot answer it. A merge's paths are read against its *first* parent, so a
   * merge resolved to keep the branch's own older copy of a published file reports no `packages/` path at
   * all - while relative to the base the PR reverts a released change. Every per-commit rule then exempts
   * it and no release intent is required for a change to the published surface. Diffing the base against
   * the head sidesteps the attribution question entirely: either the PR changes `packages/` or it does not.
   */
  const changesPublishedSurface = await touchesPublishablePackage({
    base: from,
    cwd,
    fallbackBase: effectiveFrom,
    to,
  })
  const packageReleaseIntentViolations =
    options.prTitle !== undefined &&
    options.prTitle.length > 0 &&
    (changesPublishedSurface || ownedPackageChanges.some(affectsPublishablePackage)) &&
    !hasPackageReleaseIntent(options.prTitle)
      ? [
          `Pull request title ${JSON.stringify(options.prTitle)} changes a publishable package but would not create a Release Please version bump.`,
        ]
      : []

  return {
    commits,
    effectiveFrom,
    to,
    violations: [
      ...validateConventionalCommitSubjects(commits, upstreamMergeHashes),
      ...prTitleViolations,
      ...packageReleaseIntentViolations,
    ],
  }
}

function readArgumentValue(args: readonly string[], name: string) {
  const index = args.indexOf(name)

  if (index === -1) {
    return undefined
  }

  const value = args[index + 1]
  if (value === undefined || value.startsWith('--')) {
    throw new Error(`${name} requires a value.`)
  }

  return value
}

async function main() {
  const args = process.argv.slice(CLI_ARGUMENT_START_INDEX)
  const result = await validateConventionalCommits({
    baseline: readArgumentValue(args, '--baseline'),
    from: readArgumentValue(args, '--from'),
    prTitle: readArgumentValue(args, '--pr-title'),
    to: readArgumentValue(args, '--to'),
  })

  if (result.violations.length === 0) {
    console.log(`Conventional Commit policy passed for ${result.commits.length} commit(s).`)
    return
  }

  console.error(result.violations.join('\n'))
  process.exitCode = 1
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main().catch((error: unknown) => {
    console.error(String(error))
    process.exitCode = 1
  })
}
