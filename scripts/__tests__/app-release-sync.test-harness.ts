import { execFile as execFileCallback } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { assertMatching, isMatching, P } from '@diegogbrisa/ts-match'
import { parse } from 'yaml'
import { bunExecutable } from '../support/node-runtime'

const execFile = promisify(execFileCallback)
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

const GITHUB_MOCK = String.raw`
bun() {
  case "$1" in
    scripts/app-release-state.ts|scripts/app-release-notes.ts) ;;
    *) echo "Unexpected bun command: $*" >&2; return 1 ;;
  esac
  local script="$1"
  shift
  command "$TEST_BUN" "$TEST_PROJECT_ROOT/$script" "$@"
}
fixture_advance_main() {
  if [ -n "$TEST_FUTURE_MAIN" ] && [ ! -f "$TEST_ADVANCED" ]; then
    git -C "$TEST_AUTHOR" push origin "$TEST_FUTURE_MAIN:refs/heads/main" >&2
    touch "$TEST_ADVANCED"
  fi
}
fixture_pr() {
  jq -nc --arg sha "$(git --git-dir "$TEST_REMOTE" rev-parse "$TEST_BRANCH")" \
    --arg branch "$TEST_BRANCH" --arg status "$TEST_MERGE_STATUS" \
    --arg state "$(if [ -f "$TEST_PR_CLOSED" ]; then echo CLOSED; else echo OPEN; fi)" \
    --arg version "$TEST_VERSION" \
    '{baseRefName:"main", headRefName:$branch, headRefOid:$sha,
      headRepository:{name:"OpenWaggle"}, headRepositoryOwner:{login:"OpenWaggle"},
      isCrossRepository:false, mergeCommit:null, number:221, state:$state,
      title:("chore(release): v" + $version), url:"https://example.test/pull/221",
      mergeStateStatus:$status}'
}
fixture_merged_pr() {
  jq -nc --arg sha "$GITHUB_SHA" --arg branch "$TEST_BRANCH" --arg repository "$GITHUB_REPOSITORY" \
    --arg head "$(git --git-dir "$TEST_REMOTE" rev-parse "$TEST_BRANCH")" --arg version "$TEST_VERSION" \
    '{number:301, state:"closed", merged_at:"2026-11-09T00:00:00Z", merge_commit_sha:$sha,
      base:{ref:"main"}, head:{ref:$branch, sha:$head, repo:{full_name:$repository}},
      title:("chore(release): v" + $version), merged_by:{type:"User", login:"maintainer"}}'
}
gh() {
  case "$1 $2" in
    'pr list')
      if [ -f "$TEST_PR_EXISTS" ]; then fixture_pr | jq -sc '.'; else echo '[]'; fi
      ;;
    'pr create')
      touch "$TEST_PR_EXISTS"
      echo 'create' >> "$TEST_EVENTS"
      echo 'https://example.test/pull/221'
      ;;
    'pr view')
      case "$*" in
        *'--jq .number') echo 221 ;;
        *'--jq .headRefOid') fixture_pr | jq -r '.headRefOid' ;;
        *) fixture_pr ;;
      esac
      ;;
    'api --method')
      test "$3" = 'PUT'
      test "$6" = "expected_head_sha=$(git --git-dir "$TEST_REMOTE" rev-parse "$TEST_BRANCH")"
      git -C "$TEST_AUTHOR" fetch origin main >&2
      git -C "$TEST_AUTHOR" switch "$TEST_BRANCH" >&2
      git -C "$TEST_AUTHOR" merge --no-ff origin/main -m 'Merge main into release' >&2
      if [ "$TEST_TAMPER_ON_UPDATE" = 'true' ]; then
        echo 'unexpected change' > "$TEST_AUTHOR/unexpected.txt"
        git -C "$TEST_AUTHOR" add unexpected.txt
        git -C "$TEST_AUTHOR" commit -m 'chore: unexpected update change' >&2
      fi
      git -C "$TEST_AUTHOR" push origin "$TEST_BRANCH" >&2
      echo 'update' >> "$TEST_EVENTS"
      if [ "$TEST_ADVANCE_DURING" = 'update' ]; then fixture_advance_main; fi
      ;;
    'api --paginate')
      test "$3" = "repos/$GITHUB_REPOSITORY/releases?per_page=100"
      test "$4 $5" = "--jq .[] | {tag_name, draft}"
      echo 'releases' >> "$TEST_EVENTS"
      if [ "$TEST_RELEASES_UNREADABLE" = 'true' ]; then
        echo 'HTTP 502: Bad Gateway' >&2
        return 1
      fi
      cat "$TEST_RELEASES"
      ;;
    'api repos/'*)
      case "$2" in
        "repos/$GITHUB_REPOSITORY/commits/$GITHUB_SHA/pulls") fixture_merged_pr | jq -sc '.' ;;
        "repos/$GITHUB_REPOSITORY/pulls/301") fixture_merged_pr ;;
        "repos/$GITHUB_REPOSITORY/actions/workflows/ci.yml/runs?"*)
          jq -nc --arg sha "$(git --git-dir "$TEST_REMOTE" rev-parse "$TEST_BRANCH")" \
            '{workflow_runs:[{head_sha:$sha,event:"pull_request",id:$sha,status:"completed",conclusion:"success"}]}'
          ;;
        *) echo "Unexpected gh api path: $2" >&2; return 1 ;;
      esac
      ;;
    'run view')
      jq -nc --arg sha "$3" \
        '{attempt:1,conclusion:"success",event:"pull_request",headSha:$sha,status:"completed"}'
      ;;
    'run watch')
      echo "ci $3" >> "$TEST_EVENTS"
      if [ "$TEST_ADVANCE_DURING" = 'ci' ]; then fixture_advance_main; fi
      if [ "$TEST_CLOSE_DURING_CI" = 'true' ]; then touch "$TEST_PR_CLOSED"; fi
      ;;
    *) echo "Unexpected gh command: $*" >&2; return 1 ;;
  esac
}
sleep() {
  echo 'Unexpected polling delay' >&2
  return 1
}
`

export interface ReleaseSyncOptions {
  mergeStatus?: 'BLOCKED' | 'UNKNOWN'
  orphan?: boolean
  advanceDuring?: 'ci' | 'update'
  closeDuringCi?: boolean
  tamperOnUpdate?: boolean
  tamper?: 'manifest' | 'file'
  workflow?: string
}

export function isolatedGitEnv() {
  return {
    ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))),
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'Release Tests',
    GIT_AUTHOR_EMAIL: 'tests@openwaggle.ai',
    GIT_COMMITTER_NAME: 'Release Tests',
    GIT_COMMITTER_EMAIL: 'tests@openwaggle.ai',
  }
}

export function gitRunner(env: NodeJS.ProcessEnv) {
  return async (cwd: string, ...args: string[]) => {
    const { stdout } = await execFile('git', args, { cwd, env })
    return stdout.trim()
  }
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

/** Runs one workflow step's script under the GitHub mock; a failing step resolves, not rejects. */
export function runStep(script: string, cwd: string, env: NodeJS.ProcessEnv) {
  return execFile('bash', ['-c', `${GITHUB_MOCK}\n${script}`], { cwd, env }).then(
    (output) => ({ succeeded: true, ...output }),
    (error: unknown) => {
      assertMatching({ stdout: P.string, stderr: P.string }, error)
      return { succeeded: false, stdout: error.stdout, stderr: error.stderr }
    },
  )
}

export async function readIfPresent(filePath: string) {
  return fs.readFile(filePath, 'utf8').catch(() => '')
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
    await commitManifest(BASE_MANIFEST, 'feat: initial app')
    await git(author, 'switch', '-c', RELEASE_BRANCH)
    await commitManifest(
      { ...BASE_MANIFEST, version: RELEASE_VERSION },
      `chore(release): v${RELEASE_VERSION}`,
    )
    if (options.tamper === 'manifest') {
      await commitManifest(
        { ...BASE_MANIFEST, version: RELEASE_VERSION, unauthorized: true },
        'chore: unexpected manifest change',
      )
    }
    if (options.tamper === 'file') {
      await fs.writeFile(path.join(author, 'unexpected.txt'), 'unexpected release change\n')
      await git(author, 'add', '.')
      await git(author, 'commit', '-m', 'chore: unexpected file')
    }
    await git(author, 'switch', 'main')
    const manifest = { ...BASE_MANIFEST, scripts: { 'prototype:actions': 'node serve.mts' } }
    const mainSha = await commitManifest(manifest, 'feat: project actions')
    await git(author, 'push', 'origin', 'main', RELEASE_BRANCH)
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

    const result = await runStep(await workflowStep(RELEASE_STEP, options.workflow), runner, {
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
    })
    const head = await git(runner, 'rev-parse', `origin/${RELEASE_BRANCH}`)
    return {
      ...result,
      head,
      outputs: result.succeeded ? await fs.readFile(path.join(directory, 'outputs'), 'utf8') : '',
      tags: await git(runner, 'ls-remote', '--tags', 'origin'),
      mainSha: await git(remote, 'rev-parse', 'main'),
      expectedMainSha: futureMain || mainSha,
      events: (await fs.readFile(eventsPath, 'utf8')).trim().split('\n').filter(Boolean),
      manifest: await git(runner, 'show', `${head}:package.json`),
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
