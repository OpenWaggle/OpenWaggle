import { execFile as execFileCallback } from 'node:child_process'
import { readFileSync } from 'node:fs'
import fs from 'node:fs/promises'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import { isMap, isSeq, parseDocument } from 'yaml'
import { validateConventionalCommits } from '../check-conventional-commits'
import {
  createRepository,
  git,
  GIT_IDENTITY,
  merge,
  writeAndCommit,
} from './commit-policy.test-harness'

const execFile = promisify(execFileCallback)
const workflow = parseDocument(readFileSync('.github/workflows/ci.yml', 'utf8'))

function commitPolicyStep() {
  const steps = workflow.getIn(['jobs', 'commit-policy', 'steps'], true)
  if (!isSeq(steps)) throw new Error('Commit Policy steps are missing')
  const step = steps.items.find(
    (candidate) => isMap(candidate) && candidate.get('name') === 'Validate Conventional Commits',
  )
  if (!isMap(step)) throw new Error('Commit Policy step is missing')
  return step
}

function commitPolicyRunCommand() {
  const command = commitPolicyStep().get('run')
  if (typeof command !== 'string') throw new Error('Commit Policy command is missing')
  return command
}

async function runWorkflowPolicy(input: {
  readonly cwd: string
  readonly to: string
  readonly event?: string
  readonly from?: string
  readonly prTitle?: string
}) {
  // Execute the real workflow shell block, capture its exact checker arguments,
  // then run the production validator on the same real Git history.
  const { stdout } = await execFile(
    'bash',
    ['-e', '-c', `pnpm() { printf '%s\\0' "$@"; }\n${commitPolicyRunCommand()}`],
    {
      cwd: input.cwd,
      env: {
        ...process.env,
        GITHUB_EVENT_NAME: input.event ?? 'workflow_dispatch',
        COMMIT_POLICY_FROM: input.from ?? '',
        COMMIT_POLICY_TO: input.to,
        PR_TITLE: input.prTitle ?? '',
      },
    },
  )
  const args = stdout.split('\0').slice(0, -1)
  expect(args.slice(0, 3)).toEqual(['exec', 'tsx', 'scripts/check-conventional-commits.ts'])
  expect(args.filter((arg) => arg.startsWith('--'))).toEqual(['--from', '--to', '--pr-title'])
  const from = args[args.indexOf('--from') + 1]
  const to = args[args.indexOf('--to') + 1]
  const prTitle = args[args.indexOf('--pr-title') + 1]
  expect(to).toBe(input.to)
  expect(prTitle).toBe(input.prTitle ?? '')
  return validateConventionalCommits({ cwd: input.cwd, from, to, prTitle })
}

async function syncedFeature() {
  const { baseline, cwd } = await createRepository()
  const sharedBase = await writeAndCommit(
    cwd,
    'packages/extension-sdk/package.json',
    '{"version":"0.2.0"}\n',
    'fix(extension-sdk): release package metadata',
  )
  await git(cwd, ['checkout', '-b', 'feature', baseline])
  const featureCommit = await writeAndCommit(cwd, 'feature.txt', 'feature\n', 'feat: add feature')
  const head = await merge(cwd, 'main', "Merge branch 'main' into feature")
  await git(cwd, ['checkout', 'main'])
  await writeAndCommit(cwd, 'upstream.txt', 'later upstream work\n', 'fix: advance main')
  await git(cwd, ['update-ref', 'refs/remotes/origin/main', 'HEAD'])
  await git(cwd, ['checkout', 'feature'])
  return { cwd, featureCommit, head, sharedBase }
}

describe('CI dispatched Conventional Commit range', () => {
  it('validates only candidate commits and accepts upstream syncs after main advances', async () => {
    const fixture = await syncedFeature()
    try {
      const result = await runWorkflowPolicy({ cwd: fixture.cwd, to: fixture.head })
      expect(result.violations).toEqual([])
      expect(result.effectiveFrom).toBe(fixture.sharedBase)
      expect(result.commits.map((commit) => commit.hash).sort()).toEqual(
        [fixture.featureCommit, fixture.head].sort(),
      )
    } finally {
      await fs.rm(fixture.cwd, { recursive: true, force: true })
    }
  })

  it('still rejects invalid authored subjects in the candidate range', async () => {
    const fixture = await syncedFeature()
    try {
      const invalid = await writeAndCommit(fixture.cwd, 'invalid.txt', 'invalid\n', 'bad subject')
      const result = await runWorkflowPolicy({ cwd: fixture.cwd, to: invalid })
      expect(result.violations).toEqual([
        `${invalid}: "bad subject" is not an allowed Conventional Commit subject.`,
      ])
    } finally {
      await fs.rm(fixture.cwd, { recursive: true, force: true })
    }
  })

  it('still rejects a generated merge introducing unreleased package changes', async () => {
    const fixture = await syncedFeature()
    try {
      await git(fixture.cwd, ['checkout', '-b', 'unreleased-package'])
      await writeAndCommit(
        fixture.cwd,
        'packages/extension-sdk/unreleased.ts',
        'export const unreleased = true\n',
        'feat(extension-sdk): add unreleased API',
      )
      await git(fixture.cwd, ['checkout', 'feature'])
      const head = await merge(fixture.cwd, 'unreleased-package', 'Merge unreleased package')
      const result = await runWorkflowPolicy({ cwd: fixture.cwd, to: head })
      expect(result.violations).toEqual([
        `${head}: "Merge unreleased package" affects a publishable package and must carry explicit Conventional Commit release intent.`,
      ])
    } finally {
      await fs.rm(fixture.cwd, { recursive: true, force: true })
    }
  })

  it('fails closed when the checkout lacks the authoritative base ref', async () => {
    const { cwd, baseline } = await createRepository()
    try {
      await expect(runWorkflowPolicy({ cwd, to: baseline })).rejects.toThrow()
    } finally {
      await fs.rm(cwd, { recursive: true, force: true })
    }
  })

  it('rejects ambiguous criss-cross ancestry instead of selecting an arbitrary range', async () => {
    const { cwd, baseline } = await createRepository()
    try {
      const tree = await git(cwd, ['rev-parse', `${baseline}^{tree}`])
      const commit = (...args: string[]) =>
        git(cwd, [...GIT_IDENTITY, 'commit-tree', tree, ...args])
      const left = await commit('-p', baseline, '-m', 'fix: left change')
      const right = await commit('-p', baseline, '-m', 'fix: right change')
      const head = await commit('-p', left, '-p', right, '-m', 'ci: left merge')
      const main = await commit('-p', right, '-p', left, '-m', 'ci: right merge')
      await git(cwd, ['update-ref', 'refs/remotes/origin/main', main])
      expect((await git(cwd, ['merge-base', '--all', main, head])).split('\n')).toHaveLength(2)
      await expect(runWorkflowPolicy({ cwd, to: head })).rejects.toThrow()
    } finally {
      await fs.rm(cwd, { recursive: true, force: true })
    }
  })

  it('fails closed when the candidate and authoritative base have unrelated histories', async () => {
    const { cwd, baseline } = await createRepository()
    try {
      const tree = await git(cwd, ['rev-parse', `${baseline}^{tree}`])
      const unrelated = await git(cwd, [...GIT_IDENTITY, 'commit-tree', tree, '-m', 'ci: unrelated root'])
      await git(cwd, ['update-ref', 'refs/remotes/origin/main', unrelated])
      await expect(runWorkflowPolicy({ cwd, to: baseline })).rejects.toThrow()
    } finally {
      await fs.rm(cwd, { recursive: true, force: true })
    }
  })

  it('binds synthetic queue validation to the event base, preserving upstream-sync attribution', async () => {
    const fixture = await syncedFeature()
    try {
      await git(fixture.cwd, ['checkout', 'main'])
      const queueBase = await git(fixture.cwd, ['rev-parse', 'HEAD'])
      const queued = await merge(fixture.cwd, 'feature', 'Merge feature into queue candidate')
      const unscoped = await runWorkflowPolicy({ cwd: fixture.cwd, event: 'merge_group', to: queued })
      expect(unscoped.violations).toContain(
        `${fixture.head}: "Merge branch 'main' into feature" affects a publishable package and must carry explicit Conventional Commit release intent.`,
      )
      const scoped = await runWorkflowPolicy({
        cwd: fixture.cwd,
        event: 'merge_group',
        from: queueBase,
        to: queued,
      })
      expect(scoped.violations).toEqual([])
      expect(scoped.effectiveFrom).toBe(queueBase)
      expect(scoped.commits.map((commit) => commit.hash).sort()).toEqual(
        [fixture.featureCommit, fixture.head, queued].sort(),
      )
      expect(commitPolicyStep().getIn(['env', 'COMMIT_POLICY_FROM'])).toContain(
        "github.event_name == 'merge_group' && github.event.merge_group.base_sha",
      )
    } finally {
      await fs.rm(fixture.cwd, { recursive: true, force: true })
    }
  })

  it.each(['pull_request', 'push', 'merge_group'])(
    'preserves the existing %s range and PR-title validation',
    async (event) => {
      const { cwd, baseline } = await createRepository()
      try {
        const head = await writeAndCommit(cwd, 'feature.txt', 'feature\n', 'feat: add feature')
        const result = await runWorkflowPolicy({
          cwd,
          event,
          from: event === 'merge_group' ? '' : baseline,
          to: head,
          prTitle: event === 'pull_request' ? 'bad title' : '',
        })
        expect(result.effectiveFrom).toBe(baseline)
        expect(result.commits.map((commit) => commit.hash)).toEqual([head])
        expect(result.violations).toEqual(
          event === 'pull_request'
            ? ['Pull request title "bad title" is not an allowed Conventional Commit subject.']
            : [],
        )
      } finally {
        await fs.rm(cwd, { recursive: true, force: true })
      }
    },
  )
})
