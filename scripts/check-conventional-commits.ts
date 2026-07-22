import { execFile as execFileCallback } from 'node:child_process'
import { promisify } from 'node:util'

const execFile = promisify(execFileCallback)

const ALL_ZERO_SHA_PATTERN = /^0+$/
const CLI_ARGUMENT_START_INDEX = 2
const CONVENTIONAL_COMMIT_SUBJECT_PATTERN =
  /^(?:feat|fix|docs|test|chore|refactor|ci|build|revert)(?:\([^()\r\n]+\))?!?: \S.*$/
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

function affectsPublishablePackage(commit: CommitSubject) {
  return commit.changedPaths.some((changedPath) => changedPath.startsWith('packages/'))
}

function isGeneratedNonPackageMerge(commit: CommitSubject) {
  return (
    commit.parentHashes.length > 1 &&
    commit.subject.startsWith('Merge ') &&
    !affectsPublishablePackage(commit)
  )
}

export function validateConventionalCommitSubjects(commits: readonly CommitSubject[]) {
  return commits.flatMap((commit) => {
    if (isGeneratedNonPackageMerge(commit)) {
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

async function isAncestor(cwd: string, ancestor: string, descendant: string) {
  try {
    await execFile('git', ['merge-base', '--is-ancestor', ancestor, descendant], { cwd })
    return true
  } catch {
    return false
  }
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

export async function validateConventionalCommits(options: ConventionalCommitValidationOptions = {}) {
  const cwd = options.cwd ?? process.cwd()
  const to = options.to ?? 'HEAD'
  const baseline = await resolveBaseline({ cwd, options, to })
  const from = resolveFrom(options, baseline)
  const effectiveFrom = await resolveEffectiveFrom({ baseline, cwd, from, to })
  const commits = await readCommitSubjects(cwd, effectiveFrom, to)

  const prTitleViolations =
    options.prTitle === undefined || options.prTitle.length === 0
      ? []
      : CONVENTIONAL_COMMIT_SUBJECT_PATTERN.test(options.prTitle)
        ? []
        : [
            `Pull request title "${options.prTitle}" is not an allowed Conventional Commit subject.`,
          ]

  const packageReleaseIntentViolations =
    options.prTitle !== undefined &&
    options.prTitle.length > 0 &&
    commits.some(affectsPublishablePackage) &&
    !PACKAGE_RELEASE_INTENT_PATTERN.test(options.prTitle)
      ? [
          `Pull request title ${JSON.stringify(options.prTitle)} changes a publishable package but would not create a Release Please version bump.`,
        ]
      : []

  return {
    commits,
    effectiveFrom,
    to,
    violations: [
      ...validateConventionalCommitSubjects(commits),
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
