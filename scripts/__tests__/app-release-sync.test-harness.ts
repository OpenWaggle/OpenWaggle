import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { assertMatching, isMatching, P } from '@diegogbrisa/ts-match'
import { parse } from 'yaml'
import { bunExecutable } from '../support/node-runtime'
import {
  EMPTY_CHANGELOG,
  gitRunner,
  isolatedGitEnv,
  MAIN_NOTES,
  releaseCommit,
} from './app-release-files.test-harness'
import { runStep } from './app-release-github-mock.test-harness'

export const PROJECT_ROOT = process.cwd()
const RELEASE_VERSION = '0.4.0-alpha.5'
const RELEASE_BRANCH = `app-release-v${RELEASE_VERSION}`
export const RELEASE_STEP = 'Prepare release PR or publish its protected merge'
export const BUMP_STEP = 'Determine bump from conventional commits'
export const REPOSITORY = 'OpenWaggle/OpenWaggle'
const BASE_MANIFEST = {
  name: 'release-fixture',
  version: '0.4.0-alpha.4',
  description: 'Release workflow integration fixture',
  main: 'index.js',
  license: 'MIT',
  private: true,
}

export interface ReleaseSyncOptions {
  mergeStatus?: 'BLOCKED' | 'UNKNOWN'
  orphan?: boolean
  advanceDuring?: 'ci' | 'update'
  closeDuringCi?: boolean
  tamperOnUpdate?: boolean
  tamper?: 'manifest' | 'file' | 'changelog'
  /** A version-only release branch, as the workflow wrote them before CHANGELOG.md was generated. */
  versionOnly?: boolean
  /** Main also adds hand-written notes under `## [Unreleased]` after the release branch was cut. */
  mainNotes?: boolean
  /** GitHub's update-branch fails once, and the next run starts from what the failed one left. */
  updateFailsOnce?: boolean
  workflow?: string
}

export async function workflowStep(name: string, workflowText?: string) {
  const workflow: unknown = parse(
    workflowText ??
      (await fs.readFile(path.join(PROJECT_ROOT, '.github/workflows/release.yml'), 'utf8')),
  )
  assertMatching({ jobs: { version: { steps: P.array(P._) } } }, workflow)
  const step = workflow.jobs.version.steps.find((candidate) =>
    isMatching({ name, run: P.string }, candidate),
  )
  assertMatching({ run: P.string }, step)
  return step.run
}

/** The release branch an earlier run left behind, plus any tampering the case asks for. */
async function cutReleaseBranch(input: {
  readonly author: string
  readonly env: NodeJS.ProcessEnv
  readonly git: ReturnType<typeof gitRunner>
  readonly commitManifest: (value: object, subject: string) => Promise<string>
  readonly options: ReleaseSyncOptions
}) {
  const { author, env, git, commitManifest, options } = input
  if (options.versionOnly) {
    await git(author, 'switch', '-c', RELEASE_BRANCH)
    await commitManifest(
      { ...BASE_MANIFEST, version: RELEASE_VERSION },
      `chore(release): v${RELEASE_VERSION}`,
    )
  } else {
    const release = await releaseCommit(
      author,
      env,
      RELEASE_VERSION,
      `chore(release): v${RELEASE_VERSION}`,
    )
    await git(author, 'switch', '-c', RELEASE_BRANCH, release)
  }
  if (options.tamper === 'manifest') {
    await commitManifest(
      { ...BASE_MANIFEST, version: RELEASE_VERSION, unauthorized: true },
      'chore: unexpected manifest change',
    )
  }
  if (options.tamper === 'changelog') {
    await fs.appendFile(path.join(author, 'CHANGELOG.md'), '\n- A hand edit.\n')
    await git(author, 'commit', '-am', 'chore: edit the generated entry')
  }
  if (options.tamper === 'file') {
    await fs.writeFile(path.join(author, 'unexpected.txt'), 'unexpected release change\n')
    await git(author, 'add', '.')
    await git(author, 'commit', '-m', 'chore: unexpected file')
  }
}

export async function runReleaseSync(options: ReleaseSyncOptions = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-release-sync-'))
  const author = path.join(directory, 'author')
  const remote = path.join(directory, 'remote.git')
  const runner = path.join(directory, 'runner')
  const eventsPath = path.join(directory, 'events')
  const env = isolatedGitEnv()
  const git = gitRunner(env)
  const commitManifest = async (value: object, subject: string) => {
    await fs.writeFile(path.join(author, 'package.json'), `${JSON.stringify(value, null, 2)}\n`)
    await git(author, 'add', '.')
    await git(author, 'commit', '-m', subject)
    return git(author, 'rev-parse', 'HEAD')
  }

  try {
    await git(directory, 'init', '--bare', '--initial-branch=main', remote)
    await git(directory, 'clone', remote, author)
    await fs.writeFile(path.join(author, 'CHANGELOG.md'), EMPTY_CHANGELOG)
    await commitManifest(BASE_MANIFEST, 'feat: initial app')
    await git(author, 'tag', '-a', `v${BASE_MANIFEST.version}`, '-m', 'Release')
    await cutReleaseBranch({ author, env, git, commitManifest, options })
    await git(author, 'switch', 'main')
    const manifest = { ...BASE_MANIFEST, scripts: { 'prototype:actions': 'node serve.mts' } }
    if (options.mainNotes) await fs.writeFile(path.join(author, 'CHANGELOG.md'), MAIN_NOTES)
    const mainSha = await commitManifest(manifest, 'feat: project actions (#7)')
    await git(author, 'push', '--follow-tags', 'origin', 'main', RELEASE_BRANCH)
    const futureMain = options.advanceDuring
      ? await commitManifest(
          { ...manifest, homepage: 'https://example.test/new' },
          'fix: app metadata',
        )
      : ''
    await git(directory, 'clone', remote, runner)
    const prExists = path.join(directory, 'pr-exists')
    if (!options.orphan) await fs.writeFile(prExists, '')
    await fs.writeFile(eventsPath, '')

    const step = await workflowStep(RELEASE_STEP, options.workflow)
    const stepEnv = {
      ...env,
      BUMP_SHOULD_RELEASE: 'true',
      BUMP_VERSION: RELEASE_VERSION,
      RELEASE_TARGET_VERSION: '',
      GITHUB_REPOSITORY_OWNER: 'OpenWaggle',
      GITHUB_REPOSITORY: REPOSITORY,
      GITHUB_SHA: mainSha,
      GITHUB_OUTPUT: path.join(directory, 'outputs'),
      RUNNER_TEMP: directory,
      // Alpha builds never require signing; prove the check leaves them alone.
      MACOS_SIGNING_CONFIGURED: 'false',
      MACOS_NOTARIZATION_CONFIGURED: 'false',
      TEST_PROJECT_ROOT: PROJECT_ROOT,
      TEST_BUN: bunExecutable(),
      TEST_AUTHOR: author,
      TEST_REMOTE: remote,
      TEST_BRANCH: RELEASE_BRANCH,
      TEST_VERSION: RELEASE_VERSION,
      TEST_MERGE_STATUS: options.mergeStatus ?? 'BLOCKED',
      TEST_PR_EXISTS: prExists,
      TEST_PR_CLOSED: path.join(directory, 'pr-closed'),
      TEST_CLOSE_DURING_CI: String(options.closeDuringCi === true),
      TEST_EVENTS: eventsPath,
      TEST_ADVANCED: path.join(directory, 'advanced'),
      TEST_ADVANCE_DURING: options.advanceDuring ?? '',
      TEST_TAMPER_ON_UPDATE: String(options.tamperOnUpdate === true),
      TEST_FUTURE_MAIN: futureMain,
      TEST_UPDATE_FAILS_ONCE: String(options.updateFailsOnce === true),
      TEST_UPDATE_FAILED: path.join(directory, 'update-failed'),
    }
    const first = await runStep(step, runner, stepEnv)
    const result = options.updateFailsOnce ? await runStep(step, runner, stepEnv) : first
    const head = await git(runner, 'rev-parse', `origin/${RELEASE_BRANCH}`)
    return {
      ...result,
      firstRunSucceeded: first.succeeded,
      head,
      outputs: result.succeeded ? await fs.readFile(path.join(directory, 'outputs'), 'utf8') : '',
      // Tags the run pushed: every tag but the base version's, which the fixture creates.
      tags: (await git(runner, 'ls-remote', '--tags', 'origin'))
        .split('\n')
        .filter((line) => line && !line.includes(`refs/tags/v${BASE_MANIFEST.version}`))
        .join('\n'),
      mainSha: await git(remote, 'rev-parse', 'main'),
      expectedMainSha: futureMain || mainSha,
      events: (await fs.readFile(eventsPath, 'utf8')).trim().split('\n').filter(Boolean),
      manifest: await git(runner, 'show', `${head}:package.json`),
      changelog: await git(runner, 'show', `${head}:CHANGELOG.md`),
      version: RELEASE_VERSION,
      expectedManifest: JSON.stringify(
        {
          ...manifest,
          ...(futureMain ? { homepage: 'https://example.test/new' } : {}),
          version: RELEASE_VERSION,
        },
        null,
        2,
      ),
    }
  } finally {
    await fs.rm(directory, { recursive: true, force: true })
  }
}
