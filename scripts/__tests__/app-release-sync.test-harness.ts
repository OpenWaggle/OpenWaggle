import { execFile as execFileCallback } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { assertMatching, isMatching, P } from '@diegogbrisa/ts-match'
import { parse } from 'yaml'

const execFile = promisify(execFileCallback)
const PROJECT_ROOT = process.cwd()
const RELEASE_BRANCH = 'app-release-v0.4.0-alpha.5'
const BASE_MANIFEST = {
  name: 'release-fixture',
  version: '0.4.0-alpha.4',
  description: 'Release workflow integration fixture',
  main: 'index.js',
  license: 'MIT',
  private: true,
}

const GITHUB_MOCK = String.raw`
pnpm() {
  test "$1 $2 $3" = 'exec tsx scripts/app-release-state.ts'
  shift 3
  "$TEST_NODE" --import "$TEST_TSX" "$TEST_PROJECT_ROOT/scripts/app-release-state.ts" "$@"
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
    '{baseRefName:"main", headRefName:$branch, headRefOid:$sha,
      headRepository:{name:"OpenWaggle"}, headRepositoryOwner:{login:"OpenWaggle"},
      isCrossRepository:false, mergeCommit:null, number:221, state:"OPEN",
      title:"chore(release): v0.4.0-alpha.5", url:"https://example.test/pull/221",
      mergeStateStatus:$status}'
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
    'api repos/'*)
      jq -nc --arg sha "$(git --git-dir "$TEST_REMOTE" rev-parse "$TEST_BRANCH")" \
        '{workflow_runs:[{head_sha:$sha,event:"pull_request",id:$sha}]}'
      ;;
    'run view')
      jq -nc --arg sha "$3" \
        '{attempt:1,conclusion:"success",event:"pull_request",headSha:$sha,status:"completed"}'
      ;;
    'run watch')
      echo "ci $3" >> "$TEST_EVENTS"
      if [ "$TEST_ADVANCE_DURING" = 'ci' ]; then fixture_advance_main; fi
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
  tamperOnUpdate?: boolean
  tamper?: 'manifest' | 'file'
  workflow?: string
}

export async function runReleaseSync(options: ReleaseSyncOptions = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-release-sync-'))
  const author = path.join(directory, 'author')
  const remote = path.join(directory, 'remote.git')
  const runner = path.join(directory, 'runner')
  const eventsPath = path.join(directory, 'events')
  const env = {
    ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))),
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'Release Tests',
    GIT_AUTHOR_EMAIL: 'tests@openwaggle.ai',
    GIT_COMMITTER_NAME: 'Release Tests',
    GIT_COMMITTER_EMAIL: 'tests@openwaggle.ai',
  }
  const git = async (cwd: string, ...args: string[]) => {
    const { stdout } = await execFile('git', args, { cwd, env })
    return stdout.trim()
  }
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
      { ...BASE_MANIFEST, version: '0.4.0-alpha.5' },
      'chore(release): v0.4.0-alpha.5',
    )
    if (options.tamper === 'manifest') {
      await commitManifest(
        { ...BASE_MANIFEST, version: '0.4.0-alpha.5', unauthorized: true },
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
      ? await commitManifest({ ...manifest, homepage: 'https://example.test/new' }, 'fix: app metadata')
      : ''
    await git(directory, 'clone', remote, runner)
    const prExists = path.join(directory, 'pr-exists')
    if (!options.orphan) await fs.writeFile(prExists, '')
    await fs.writeFile(eventsPath, '')

    const workflow: unknown = parse(
      options.workflow ?? await fs.readFile(path.join(PROJECT_ROOT, '.github/workflows/release.yml'), 'utf8'),
    )
    assertMatching({ jobs: { version: { steps: P.array(P._) } } }, workflow)
    const step = workflow.jobs.version.steps.find((candidate) =>
      isMatching({ name: 'Prepare release PR or publish its protected merge', run: P.string }, candidate),
    )
    assertMatching({ run: P.string }, step)

    const result = await execFile('bash', ['-c', `${GITHUB_MOCK}\n${step.run}`], {
      cwd: runner,
      env: {
        ...env,
        BUMP_SHOULD_RELEASE: 'true',
        BUMP_VERSION: '0.4.0-alpha.5',
        RELEASE_TARGET_VERSION: '',
        GITHUB_REPOSITORY_OWNER: 'OpenWaggle',
        GITHUB_REPOSITORY: 'OpenWaggle/OpenWaggle',
        GITHUB_SHA: mainSha,
        GITHUB_OUTPUT: path.join(directory, 'outputs'),
        RUNNER_TEMP: directory,
        TEST_PROJECT_ROOT: PROJECT_ROOT,
        TEST_NODE: process.execPath,
        TEST_TSX: import.meta.resolve('tsx'),
        TEST_AUTHOR: author,
        TEST_REMOTE: remote,
        TEST_BRANCH: RELEASE_BRANCH,
        TEST_MERGE_STATUS: options.mergeStatus ?? 'BLOCKED',
        TEST_PR_EXISTS: prExists,
        TEST_EVENTS: eventsPath,
        TEST_ADVANCED: path.join(directory, 'advanced'),
        TEST_ADVANCE_DURING: options.advanceDuring ?? '',
        TEST_TAMPER_ON_UPDATE: String(options.tamperOnUpdate === true),
        TEST_FUTURE_MAIN: futureMain,
      },
    }).then(
      (output) => ({ succeeded: true, ...output }),
      (error: unknown) => {
        assertMatching({ stdout: P.string, stderr: P.string }, error)
        return { succeeded: false, stdout: error.stdout, stderr: error.stderr }
      },
    )
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
        { ...manifest, ...(futureMain ? { homepage: 'https://example.test/new' } : {}), version: '0.4.0-alpha.5' },
        null,
        2,
      ),
    }
  } finally {
    await fs.rm(directory, { recursive: true, force: true })
  }
}
