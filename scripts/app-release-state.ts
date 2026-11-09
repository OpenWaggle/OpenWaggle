import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import { pathToFileURL } from 'node:url'
import { isMatching, P } from '@diegogbrisa/ts-match'
import { Schema } from 'effect'

const ARG_VALUE_OFFSET = 1
const CLI_COMMAND_INDEX = 2
const JSON_INDENT = 2
const RELEASE_SUBJECT_PATTERN =
  /^chore\(release\): v([0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?)(?: \(#[0-9]+\))?$/u
const APP_VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)(?:-(alpha|beta|rc)\.(\d+))?$/u
const CHANNEL_RANK = { alpha: 0, beta: 1, rc: 2, stable: 3 } as const
const RELEASE_CANDIDATE_TAG_PATTERN = /^v(?<core>\d+\.\d+\.\d+)-rc\.(?<sequence>\d+)$/u
const ROOT_MANIFEST_PATH = 'package.json'
/**
 * Paths that never enter a desktop app artifact, so they may change between RC and Stable. The
 * website's user docs are the exception: `docs:generate` bundles them into the app.
 */
const PROMOTION_IGNORED_PATH_PATTERNS = [
  /^website\/(?!src\/content\/docs\/)/u,
  /^docs\//u,
  /^\.agents\//u,
  /^[^/]+\.md$/u,
]
/**
 * Files that match an ignored pattern but ship inside the app (`extraResources` in
 * electron-builder.ts), so a change to them blocks promotion like any other app change.
 */
const PROMOTION_APP_CONTENT_PATHS: ReadonlySet<string> = new Set(['THIRD_PARTY_NOTICES.md'])
const STABLE_VERSION_PATTERN = /^\d+\.\d+\.\d+$/u
const MAJOR_RELEASE_PATTERN = /^\d+\.0\.0$/u

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
/** One line of `gh api --paginate repos/<repo>/releases --jq '.[] | {tag_name, draft}'`. */
const gitHubReleaseLineSchema = Schema.parseJson(
  Schema.Struct({ tag_name: Schema.String, draft: Schema.Boolean }),
)
const manifestJsonSchema = Schema.parseJson(
  Schema.Record({ key: Schema.String, value: Schema.Unknown }),
)

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

/** A new major version always ships through a release candidate; minors and patches need not. */
export function requiresReleaseCandidate(targetVersion: string) {
  return MAJOR_RELEASE_PATTERN.test(targetVersion)
}

function manifestWithoutVersion(manifestJson: string) {
  const { version: _version, ...rest } = Schema.decodeUnknownSync(manifestJsonSchema)(manifestJson)
  return JSON.stringify(rest)
}

/**
 * The newest `vX.Y.Z-rc.N` tag for a Stable target `X.Y.Z`, or null when the target is a
 * prerelease or no release candidate exists for it.
 */
export function latestReleaseCandidateTag(tags: readonly string[], targetVersion: string) {
  if (!STABLE_VERSION_PATTERN.test(targetVersion)) return null
  let selected: { readonly tag: string; readonly sequence: number } | null = null
  for (const tag of tags) {
    const groups = RELEASE_CANDIDATE_TAG_PATTERN.exec(tag)?.groups
    if (!groups || groups.core !== targetVersion) continue
    const sequence = Number(groups.sequence)
    if (!selected || sequence > selected.sequence) selected = { tag, sequence }
  }
  return selected?.tag ?? null
}

/**
 * Tags of the published (non-draft) GitHub releases in `gh api` JSON Lines output. A release tag
 * can exist without a release: the workflow pushes the tag before the builds run, and
 * `v1.0.0-beta.33` through `beta.35` never published because their macOS builds were cancelled.
 * Fails closed on unreadable input or an empty list, because an empty list would let a minor or
 * patch skip the guard.
 */
export function publishedReleaseTags(gitHubReleaseLines: string) {
  const releases = gitHubReleaseLines
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => Schema.decodeUnknownSync(gitHubReleaseLineSchema)(line))
  if (releases.length === 0) {
    throw new Error('The GitHub release list is empty; the promotion guard cannot run without it.')
  }
  return releases.filter((release) => !release.draft).map((release) => release.tag_name)
}

/** Whether a change to this path can never reach a desktop app artifact. */
export function isPromotionIgnoredPath(changedPath: string) {
  if (PROMOTION_APP_CONTENT_PATHS.has(changedPath)) return false
  return PROMOTION_IGNORED_PATH_PATTERNS.some((pattern) => pattern.test(changedPath))
}

/**
 * Paths that make a Stable candidate differ from its last release candidate. Non-app paths are
 * ignored, and the root manifest may differ only in its version.
 */
export function promotionGuardViolations(input: {
  readonly changedPaths: readonly string[]
  readonly releaseCandidateManifestJson: string
  readonly candidateManifestJson: string
}) {
  return input.changedPaths.filter((changedPath) => {
    if (isPromotionIgnoredPath(changedPath)) return false
    if (changedPath !== ROOT_MANIFEST_PATH) return true
    return (
      manifestWithoutVersion(input.releaseCandidateManifestJson) !==
      manifestWithoutVersion(input.candidateManifestJson)
    )
  })
}

function git(args: readonly string[]) {
  return execFileSync('git', args, { encoding: 'utf8' })
}

function verifyPromotion(targetVersion: string, candidateRef: string, releasesPath: string | undefined) {
  if (!STABLE_VERSION_PATTERN.test(targetVersion)) {
    process.stdout.write(`${targetVersion} is a prerelease; the promotion guard applies to Stable only.\n`)
    return
  }
  if (!releasesPath) {
    throw new Error(`Stable ${targetVersion} needs --releases with the GitHub release list.`)
  }
  // The last RC users actually received is the newest one with a published GitHub release, not
  // the newest tag: a tag whose builds failed never shipped.
  const publishedTags = publishedReleaseTags(fs.readFileSync(releasesPath, 'utf8'))
  const releaseCandidateTag = latestReleaseCandidateTag(publishedTags, targetVersion)
  const unpublishedTags = git(['tag', '--list', `v${targetVersion}-rc.*`])
    .split('\n')
    .filter((tag) => tag !== '' && !publishedTags.includes(tag))
  if (unpublishedTags.length > 0) {
    process.stdout.write(`Ignoring release candidate tags without a published release: ${unpublishedTags.join(', ')}.\n`)
  }
  if (!releaseCandidateTag) {
    // A new major version always ships through a release candidate; later minors and patches may
    // release straight to Stable (docs/release-and-versioning.md, "After 1.0.0").
    if (requiresReleaseCandidate(targetVersion)) {
      throw new Error(`Stable ${targetVersion} needs a published ${targetVersion}-rc.N release first.`)
    }
    process.stdout.write(`No published release candidate precedes ${targetVersion}; promotion guard skipped.\n`)
    return
  }
  try {
    git(['rev-parse', '--verify', '--quiet', `refs/tags/${releaseCandidateTag}^{commit}`])
  } catch {
    throw new Error(`Published release candidate ${releaseCandidateTag} has no tag in this checkout.`)
  }
  // --no-renames lists both sides of a move, so moving app code into an ignored path still counts.
  const changedPaths = git(['diff', '--name-only', '--no-renames', releaseCandidateTag, candidateRef])
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
  process.stdout.write(`Stable ${targetVersion} matches ${releaseCandidateTag}, the last published release candidate.\n`)
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
