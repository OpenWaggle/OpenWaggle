import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  BUMP_STEP,
  gitRunner,
  isolatedGitEnv,
  PROJECT_ROOT,
  readIfPresent,
  RELEASE_STEP,
  REPOSITORY,
  runStep,
  workflowStep,
} from './app-release-sync.test-harness'

/**
 * One step of `main`'s history in a release train fixture. A release commits the version-only
 * `chore(release)` change and tags it; `release` says whether GitHub has a published release for
 * the tag, only a draft, or nothing (the tag of a build that failed, like `v1.0.0-beta.33`).
 */
export type ReleaseTrainHistoryEntry =
  | {
      readonly kind: 'change'
      readonly subject: string
      readonly path: string
      readonly content?: string
    }
  | {
      readonly kind: 'release'
      readonly version: string
      readonly release: 'published' | 'draft' | 'none'
    }

type ReleaseTrainRun =
  | { readonly kind: 'dispatch'; readonly targetVersion: string }
  | { readonly kind: 'merge' }
  | { readonly kind: 'release-merge'; readonly version: string }

export interface ReleaseTrainOptions {
  /** The version of the fixture's first commit. */
  readonly initialVersion: string
  readonly history: readonly ReleaseTrainHistoryEntry[]
  /** The root CHANGELOG.md on main; omitted means no file. */
  readonly changelog?: string
  /**
   * `dispatch` is a `target_version` dispatch, `merge` an ordinary push to main (the bump step runs
   * first), and `release-merge` the push of a maintainer-merged release PR for `version`.
   */
  readonly run: ReleaseTrainRun
  /** Whether the macOS signing secrets are configured (default true). */
  readonly macosSigning?: boolean
  /** Whether the macOS notarization secrets are configured (default true). */
  readonly macosNotarization?: boolean
  /** Makes the GitHub release list request fail. */
  readonly releasesUnreadable?: boolean
  /** Tags GitHub lists as published releases although the checkout has no such tag. */
  readonly publishedWithoutTag?: readonly string[]
}

const TRAIN_MANIFEST = {
  name: 'release-train-fixture',
  description: 'Release workflow RC and Stable fixture',
  private: true,
}
const FIRST_RELEASE_PR_NUMBER = 200

interface TrainPaths {
  readonly directory: string
  readonly author: string
  readonly remote: string
  readonly runner: string
  readonly events: string
  readonly releases: string
  readonly outputs: string
}

type Git = ReturnType<typeof gitRunner>

function manifestFile(version: string) {
  return { 'package.json': `${JSON.stringify({ ...TRAIN_MANIFEST, version }, null, 2)}\n` }
}

function committer(git: Git, author: string) {
  return async (files: Record<string, string>, subject: string) => {
    for (const [relativePath, content] of Object.entries(files)) {
      await fs.mkdir(path.dirname(path.join(author, relativePath)), { recursive: true })
      await fs.writeFile(path.join(author, relativePath), content)
    }
    await git(author, 'add', '.')
    await git(author, 'commit', '-m', subject)
    return git(author, 'rev-parse', 'HEAD')
  }
}

/**
 * Builds `main` from `history` and pushes it with its tags, plus the merged release PR branch for
 * `release-merge`. Writes GitHub's release list as `gh api --jq` JSON Lines and returns main's head.
 */
async function buildTrainFixture(options: ReleaseTrainOptions, paths: TrainPaths, git: Git) {
  const commit = committer(git, paths.author)
  await git(paths.directory, 'init', '--bare', '--initial-branch=main', paths.remote)
  await git(paths.directory, 'clone', paths.remote, paths.author)
  await commit(
    {
      ...manifestFile(options.initialVersion),
      'src/app.ts': 'export const app = 1\n',
      'THIRD_PARTY_NOTICES.md': '# Third-party notices\n',
      ...(options.changelog === undefined ? {} : { 'CHANGELOG.md': options.changelog }),
    },
    'feat: initial app',
  )
  // GitHub lists draft releases to a token with push access, and package releases share the list.
  const githubReleases = [
    { tag_name: 'v0.3.0-alpha.69', draft: true },
    { tag_name: 'waggle-core-v0.2.0', draft: false },
  ]
  for (const [index, entry] of options.history.entries()) {
    if (entry.kind === 'change') {
      await commit({ [entry.path]: entry.content ?? `${entry.subject}\n` }, entry.subject)
      continue
    }
    await commit(
      manifestFile(entry.version),
      `chore(release): v${entry.version} (#${FIRST_RELEASE_PR_NUMBER + index})`,
    )
    await git(paths.author, 'tag', '-a', `v${entry.version}`, '-m', `Release v${entry.version}`)
    if (entry.release !== 'none') {
      githubReleases.push({ tag_name: `v${entry.version}`, draft: entry.release === 'draft' })
    }
  }
  for (const tag of options.publishedWithoutTag ?? [])
    githubReleases.push({ tag_name: tag, draft: false })
  await fs.writeFile(
    paths.releases,
    githubReleases.map((release) => `${JSON.stringify(release)}\n`).join(''),
  )

  let mainSha = await git(paths.author, 'rev-parse', 'HEAD')
  if (options.run.kind === 'release-merge') {
    const version = options.run.version
    await git(paths.author, 'switch', '-c', `app-release-v${version}`)
    await commit(manifestFile(version), `chore(release): v${version}`)
    await git(paths.author, 'switch', 'main')
    mainSha = await commit(manifestFile(version), `chore(release): v${version} (#301)`)
    await git(paths.author, 'push', 'origin', `app-release-v${version}`)
  }
  await git(paths.author, 'push', '--follow-tags', 'origin', 'main')
  await git(paths.directory, 'clone', paths.remote, paths.runner)
  await fs.writeFile(paths.events, '')
  return mainSha
}

/** Runs the bump step for an ordinary merge and returns its outputs, as the release step reads them. */
async function runBump(paths: TrainPaths, stepEnv: NodeJS.ProcessEnv) {
  const bumpOutputsPath = path.join(paths.directory, 'bump-outputs')
  const bump = await runStep(await workflowStep(BUMP_STEP), paths.runner, {
    ...stepEnv,
    GITHUB_OUTPUT: bumpOutputsPath,
  })
  const outputs = await readIfPresent(bumpOutputsPath)
  return {
    succeeded: bump.succeeded,
    stdout: bump.stdout,
    stderr: bump.stderr,
    shouldRelease: /^should_release=(.*)$/mu.exec(outputs)?.[1] ?? '',
    version: /^new_version=(.*)$/mu.exec(outputs)?.[1] ?? '',
  }
}

async function remoteTags(git: Git, remote: string) {
  const tags: Record<string, string> = {}
  for (const tag of (await git(remote, 'tag', '--list')).split('\n').filter(Boolean)) {
    tags[tag] = await git(remote, 'rev-parse', `${tag}^{commit}`)
  }
  return tags
}

function releaseVersionOf(run: ReleaseTrainRun, bumpVersion: string) {
  if (run.kind === 'dispatch') return run.targetVersion
  if (run.kind === 'release-merge') return run.version
  return bumpVersion
}

/**
 * Runs the version job of release.yml against a local Git remote whose `main` follows `history`.
 * Covers the RC and Stable paths: version computation, the CHANGELOG and promotion gates, the
 * macOS signing precheck, release PR preparation, and tagging a merged release commit.
 */
export async function runReleaseTrain(options: ReleaseTrainOptions) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-release-train-'))
  const paths: TrainPaths = {
    directory,
    author: path.join(directory, 'author'),
    remote: path.join(directory, 'remote.git'),
    runner: path.join(directory, 'runner'),
    events: path.join(directory, 'events'),
    releases: path.join(directory, 'github-releases.jsonl'),
    outputs: path.join(directory, 'outputs'),
  }
  const env = isolatedGitEnv()
  const git = gitRunner(env)

  try {
    const mainSha = await buildTrainFixture(options, paths, git)
    const stepEnv = {
      ...env,
      GITHUB_REPOSITORY_OWNER: 'OpenWaggle',
      GITHUB_REPOSITORY: REPOSITORY,
      GITHUB_SHA: mainSha,
      RUNNER_TEMP: directory,
      TEST_PROJECT_ROOT: PROJECT_ROOT,
      TEST_NODE: process.execPath,
      TEST_TSX: import.meta.resolve('tsx'),
      TEST_AUTHOR: paths.author,
      TEST_REMOTE: paths.remote,
      TEST_MERGE_STATUS: 'BLOCKED',
      TEST_PR_EXISTS: path.join(directory, 'pr-exists'),
      TEST_PR_CLOSED: path.join(directory, 'pr-closed'),
      TEST_CLOSE_DURING_CI: 'false',
      TEST_EVENTS: paths.events,
      TEST_ADVANCED: path.join(directory, 'advanced'),
      TEST_ADVANCE_DURING: '',
      TEST_TAMPER_ON_UPDATE: 'false',
      TEST_FUTURE_MAIN: '',
      TEST_RELEASES: paths.releases,
      TEST_RELEASES_UNREADABLE: String(options.releasesUnreadable === true),
    }
    const bump = options.run.kind === 'merge' ? await runBump(paths, stepEnv) : null
    const releaseVersion = releaseVersionOf(options.run, bump?.version ?? '')
    const releaseBranch = `app-release-v${releaseVersion}`
    // A failed bump step fails the job, so the release step never runs.
    const result =
      bump?.succeeded === false
        ? bump
        : await runStep(await workflowStep(RELEASE_STEP), paths.runner, {
            ...stepEnv,
            BUMP_SHOULD_RELEASE: bump?.shouldRelease ?? '',
            BUMP_VERSION: bump?.version ?? '',
            RELEASE_TARGET_VERSION:
              options.run.kind === 'dispatch' ? options.run.targetVersion : '',
            GITHUB_OUTPUT: paths.outputs,
            MACOS_SIGNING_CONFIGURED: String(options.macosSigning ?? true),
            MACOS_NOTARIZATION_CONFIGURED: String(options.macosNotarization ?? true),
            TEST_BRANCH: releaseBranch,
            TEST_VERSION: releaseVersion,
          })
    const missing = () => null
    return {
      succeeded: result.succeeded,
      stdout: result.stdout,
      stderr: result.stderr,
      bumpVersion: bump?.version ?? '',
      mainSha,
      tags: await remoteTags(git, paths.remote),
      outputs: await readIfPresent(paths.outputs),
      events: (await fs.readFile(paths.events, 'utf8')).trim().split('\n').filter(Boolean),
      releaseBranchHead: await git(
        paths.remote,
        'rev-parse',
        '--verify',
        '--quiet',
        `refs/heads/${releaseBranch}`,
      ).catch(missing),
      releaseBranchManifest: await git(
        paths.remote,
        'show',
        `refs/heads/${releaseBranch}:package.json`,
      ).catch(missing),
    }
  } finally {
    await fs.rm(directory, { recursive: true, force: true })
  }
}
