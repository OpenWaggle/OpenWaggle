/**
 * The RC freeze promotion guard's pure decisions (docs/release-and-versioning.md, "RC freeze and
 * promotion guard"). `app-release-state.ts verify-promotion` feeds them Git and GitHub data.
 */
import { Schema } from 'effect'
import { namedGroups } from '@shared/utils/regex-named-groups'

export const APP_VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)(?:-(alpha|beta|rc)\.(\d+))?$/u
export const ROOT_MANIFEST_PATH = 'package.json'
const RELEASE_CANDIDATE_TAG_PATTERN = /^v(?<core>\d+\.\d+\.\d+)-rc\.(?<sequence>\d+)$/u
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
/** One line of `gh api --paginate repos/<repo>/releases --jq '.[] | {tag_name, draft}'`. */
const gitHubReleaseLineSchema = Schema.parseJson(
  Schema.Struct({ tag_name: Schema.String, draft: Schema.Boolean }),
)
export const manifestJsonSchema = Schema.parseJson(
  Schema.Record({ key: Schema.String, value: Schema.Unknown }),
)

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
    const groups = namedGroups(RELEASE_CANDIDATE_TAG_PATTERN.exec(tag), ['core', 'sequence'])
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

export type PromotionBase =
  | { readonly kind: 'skip'; readonly reason: string }
  | { readonly kind: 'compare'; readonly tag: string; readonly ignoredTags: readonly string[] }

function releaseCandidateTagsFor(tags: readonly string[], targetVersion: string) {
  return tags.filter(
    (tag) => namedGroups(RELEASE_CANDIDATE_TAG_PATTERN.exec(tag), ['core'])?.core === targetVersion,
  )
}

/**
 * Decides what a Stable promotion compares with. `gitHubReleaseLines` is the `gh api` release list
 * (undefined when the workflow passed none) and `localTags` the checkout's tags. The base is the
 * newest RC with a published release, never a tag whose builds did not ship. Throws when the
 * target is malformed, the release list is missing or unreadable, a new major has no published
 * RC, a minor or patch has RC tags but none published, or the base tag is not in the checkout.
 */
export function promotionBase(input: {
  readonly targetVersion: string
  readonly gitHubReleaseLines: string | undefined
  readonly localTags: readonly string[]
}): PromotionBase {
  const { targetVersion } = input
  if (!APP_VERSION_PATTERN.test(targetVersion)) {
    throw new Error(`Invalid desktop app version: ${targetVersion}.`)
  }
  if (!STABLE_VERSION_PATTERN.test(targetVersion)) {
    return {
      kind: 'skip',
      reason: `${targetVersion} is a prerelease; the promotion guard applies to Stable only.`,
    }
  }
  if (input.gitHubReleaseLines === undefined) {
    throw new Error(`Stable ${targetVersion} needs --releases with the GitHub release list.`)
  }
  const publishedTags = publishedReleaseTags(input.gitHubReleaseLines)
  const tag = latestReleaseCandidateTag(publishedTags, targetVersion)
  const localReleaseCandidateTags = releaseCandidateTagsFor(input.localTags, targetVersion)
  const ignoredTags = localReleaseCandidateTags.filter(
    (localTag) => !publishedTags.includes(localTag),
  )
  if (!tag) {
    // A new major version always ships through a release candidate; later minors and patches may
    // release straight to Stable (docs/release-and-versioning.md, "After 1.0.0").
    if (requiresReleaseCandidate(targetVersion)) {
      throw new Error(
        `Stable ${targetVersion} needs a published ${targetVersion}-rc.N release first.`,
      )
    }
    // A minor or patch that started an RC train whose builds never shipped must not quietly drop
    // its freeze: publish a release candidate or delete the stray tags.
    if (ignoredTags.length > 0) {
      throw new Error(
        `Stable ${targetVersion} has release candidate tags but no published release candidate. ` +
          `Publish ${targetVersion}-rc.N first, or delete these tags to release without one: ${ignoredTags.join(', ')}.`,
      )
    }
    return {
      kind: 'skip',
      reason: `No published release candidate precedes ${targetVersion}; promotion guard skipped.`,
    }
  }
  if (!localReleaseCandidateTags.includes(tag)) {
    throw new Error(`Published release candidate ${tag} has no tag in this checkout.`)
  }
  return { kind: 'compare', tag, ignoredTags }
}
