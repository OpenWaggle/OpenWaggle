import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import { pathToFileURL } from 'node:url'
import { isMatching, P } from '@diegogbrisa/ts-match'
import { Schema } from 'effect'
import {
  APP_VERSION_PATTERN,
  manifestJsonSchema,
  promotionBase,
  promotionGuardViolations,
  ROOT_MANIFEST_PATH,
} from './app-release-promotion'

const ARG_VALUE_OFFSET = 1
const CLI_COMMAND_INDEX = 2
const JSON_INDENT = 2
const RELEASE_SUBJECT_PATTERN =
  /^chore\(release\): v([0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?)(?: \(#[0-9]+\))?$/u
const CHANNEL_RANK = { alpha: 0, beta: 1, rc: 2, stable: 3 } as const

const pullRequestSchema = Schema.Struct({
  baseRefName: Schema.String,
  headRefName: Schema.String,
  headRefOid: Schema.String,
  headRepository: Schema.Struct({ name: Schema.String }),
  headRepositoryOwner: Schema.Struct({ login: Schema.String }),
  isCrossRepository: Schema.Boolean,
  mergeCommit: Schema.NullOr(Schema.Struct({ oid: Schema.String })),
  number: Schema.Number,
  state: Schema.String,
  title: Schema.String,
  url: Schema.String,
})
const pullRequestListJsonSchema = Schema.parseJson(Schema.Array(pullRequestSchema))

export type AppReleasePullRequest = typeof pullRequestSchema.Type

export interface ReleasePullRequestIdentity {
  readonly branch: string
  readonly owner: string
  readonly repository: string
}

export function selectOwnedReleasePullRequests(
  pullRequests: readonly AppReleasePullRequest[],
  identity: ReleasePullRequestIdentity,
) {
  return pullRequests.filter(
    (pullRequest) =>
      pullRequest.isCrossRepository === false &&
      pullRequest.headRepositoryOwner.login === identity.owner &&
      pullRequest.headRepository.name === identity.repository &&
      pullRequest.headRefName === identity.branch,
  )
}

export function expectedVersionOnlyManifest(baseManifestJson: string, version: string) {
  const manifest = Schema.decodeUnknownSync(manifestJsonSchema)(baseManifestJson)
  return `${JSON.stringify({ ...manifest, version }, null, JSON_INDENT)}\n`
}

function git(args: readonly string[]) {
  return execFileSync('git', args, { encoding: 'utf8' })
}

function verifyPromotion(
  targetVersion: string,
  candidateRef: string,
  releasesPath: string | undefined,
) {
  const base = promotionBase({
    targetVersion,
    gitHubReleaseLines:
      releasesPath === undefined ? undefined : fs.readFileSync(releasesPath, 'utf8'),
    localTags: git(['tag', '--list', `v${targetVersion}-rc.*`])
      .split('\n')
      .filter(Boolean),
  })
  if (base.kind === 'skip') {
    process.stdout.write(`${base.reason}\n`)
    return
  }
  const releaseCandidateTag = base.tag
  if (base.ignoredTags.length > 0) {
    process.stdout.write(
      `Ignoring release candidate tags without a published release: ${base.ignoredTags.join(', ')}.\n`,
    )
  }
  // --no-renames lists both sides of a move, so moving app code into an ignored path still counts.
  const changedPaths = git([
    'diff',
    '--name-only',
    '--no-renames',
    releaseCandidateTag,
    candidateRef,
  ])
    .split('\n')
    .filter(Boolean)
  const violations = promotionGuardViolations({
    changedPaths,
    releaseCandidateManifestJson: git(['show', `${releaseCandidateTag}:${ROOT_MANIFEST_PATH}`]),
    candidateManifestJson: git(['show', `${candidateRef}:${ROOT_MANIFEST_PATH}`]),
  })
  if (violations.length > 0) {
    throw new Error(
      `Stable ${targetVersion} must match ${releaseCandidateTag}, the last published release candidate, apart from its version and non-app paths. ` +
        `Revert these changes or release them as the next release candidate:\n${violations.join('\n')}`,
    )
  }
  process.stdout.write(
    `Stable ${targetVersion} matches ${releaseCandidateTag}, the last published release candidate.\n`,
  )
}

export function releaseSubjectVersion(subject: string) {
  return RELEASE_SUBJECT_PATTERN.exec(subject)?.[1] ?? null
}

function parseAppVersion(version: string) {
  const match = APP_VERSION_PATTERN.exec(version)
  if (!match) throw new Error(`Invalid desktop app version: ${version}.`)
  const [, major, minor, patch, channel, sequence] = match
  const normalizedChannel = channel ?? 'stable'
  if (!isMatching(P.union('alpha', 'beta', 'rc', 'stable'), normalizedChannel)) {
    throw new Error(`Invalid desktop app release channel: ${normalizedChannel}.`)
  }
  return {
    core: [Number(major), Number(minor), Number(patch)] as const,
    channel: normalizedChannel,
    sequence: sequence === undefined ? 0 : Number(sequence),
  }
}

export function assertForwardAppVersionTransition(current: string, target: string) {
  const from = parseAppVersion(current)
  const to = parseAppVersion(target)
  for (let index = 0; index < from.core.length; index += 1) {
    const difference = (to.core[index] ?? 0) - (from.core[index] ?? 0)
    if (difference > 0) return
    if (difference < 0) throw new Error(`Release target ${target} is older than ${current}.`)
  }
  const channelDifference = CHANNEL_RANK[to.channel] - CHANNEL_RANK[from.channel]
  if (channelDifference > 0) return
  if (channelDifference === 0 && to.sequence > from.sequence) return
  throw new Error(`Release target ${target} does not advance ${current}.`)
}

function optionalArgument(name: string) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + ARG_VALUE_OFFSET] : undefined
}

function argument(name: string) {
  const value = optionalArgument(name)
  if (!value) {
    throw new Error(`Missing required argument ${name}.`)
  }
  return value
}

async function readStandardInput() {
  process.stdin.setEncoding('utf8')
  let input = ''
  for await (const chunk of process.stdin) {
    input += String(chunk)
  }
  return input
}

async function runCli() {
  const command = process.argv[CLI_COMMAND_INDEX]
  if (command === 'filter-prs') {
    const pullRequests = Schema.decodeUnknownSync(pullRequestListJsonSchema)(
      await readStandardInput(),
    )
    const selected = selectOwnedReleasePullRequests(pullRequests, {
      branch: argument('--branch'),
      owner: argument('--owner'),
      repository: argument('--repository'),
    })
    process.stdout.write(JSON.stringify(selected))
    return
  }

  if (command === 'expected-manifest') {
    const basePath = argument('--base')
    const outputPath = argument('--output')
    const version = argument('--version')
    const expected = expectedVersionOnlyManifest(fs.readFileSync(basePath, 'utf8'), version)
    fs.writeFileSync(outputPath, expected)
    return
  }

  if (command === 'release-subject-version') {
    const version = releaseSubjectVersion(argument('--subject'))
    if (!version) {
      throw new Error('Commit subject is not a release subject.')
    }
    process.stdout.write(version)
    return
  }

  if (command === 'verify-promotion') {
    verifyPromotion(argument('--target'), argument('--candidate'), optionalArgument('--releases'))
    return
  }

  if (command === 'validate-transition') {
    assertForwardAppVersionTransition(argument('--current'), argument('--target'))
    return
  }

  throw new Error(`Unsupported app release state command: ${String(command)}.`)
}

const entryPath = process.argv[1]
if (entryPath && import.meta.url === pathToFileURL(entryPath).href) {
  void runCli().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
