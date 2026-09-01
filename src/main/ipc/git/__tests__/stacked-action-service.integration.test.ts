import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { pushCurrentBranch } from '../push-service'
import { runStackedGitAction, type StackedActionDeps } from '../stacked-action-service'

const execFileAsync = promisify(execFile)
const IDENTITY = ['-c', 'user.name=OpenWaggle Test', '-c', 'user.email=test@openwaggle.local']

async function git(cwd: string, args: readonly string[]) {
  const result = await execFileAsync('git', [...IDENTITY, ...args], { cwd })
  return result.stdout.trim()
}

describe('stacked change-request workflow integration', () => {
  let root = ''
  let repository = ''
  let remote = ''

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'openwaggle-stacked-action-'))
    repository = path.join(root, 'repository')
    remote = path.join(root, 'remote.git')
    await mkdir(repository)
    await git(repository, ['init', '-b', 'main'])
    await writeFile(path.join(repository, 'feature.txt'), 'baseline\n')
    await git(repository, ['add', 'feature.txt'])
    await git(repository, ['commit', '-m', 'Baseline'])
    await git(root, ['init', '--bare', remote])
    await git(repository, ['remote', 'add', 'origin', remote])
    await git(repository, ['push', '-u', 'origin', 'main'])
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('creates, commits, pushes, and sends draft metadata to the provider boundary', async () => {
    await writeFile(path.join(repository, 'feature.txt'), 'review-ready\n')
    const openChangeRequest = vi.fn(async (_projectPath, payload) => ({
      ok: true as const,
      changeRequest: {
        title: payload.title,
        url: 'https://github.com/openwaggle/openwaggle/pull/42',
        baseRef: payload.baseRef,
        headRef: payload.headRef,
        state: 'draft' as const,
      },
    }))
    const deps: StackedActionDeps = {
      hasWorkingTreeChanges: async () => ({
        ok: true,
        hasChanges: (await git(repository, ['status', '--porcelain=v1'])).length > 0,
      }),
      listBranchNames: async () =>
        (await git(repository, ['for-each-ref', '--format=%(refname:short)', 'refs/heads']))
          .split('\n')
          .filter(Boolean),
      createBranch: async (_projectPath, name, baseRef) => {
        await git(repository, ['switch', '-c', name, baseRef ?? 'main'])
        return { ok: true, message: `Created ${name}` }
      },
      commit: async (_projectPath, message, paths) => {
        await git(repository, ['add', '--', ...(paths ?? [])])
        await git(repository, ['commit', '-m', message, '--', ...(paths ?? [])])
        return {
          ok: true,
          commitHash: await git(repository, ['rev-parse', 'HEAD']),
          summary: message,
        }
      },
      push: () => pushCurrentBranch(repository),
      pull: async () => ({ ok: true, code: 'ok', message: 'unused' }),
      openChangeRequest,
      resolveCurrentRef: () => git(repository, ['branch', '--show-current']),
      resolveDefaultBaseRef: async () => 'main',
      resolvePrimaryRemoteUrl: async () => remote,
      buildChangeRequestFallbackUrl: async () => null,
    }

    const result = await runStackedGitAction(deps, repository, {
      action: 'commit_push_pr',
      commitMessage: 'Ship review-ready change',
      paths: ['feature.txt'],
      createFeatureBranch: true,
      featureBranchName: 'codex/review-ready',
      baseRef: 'main',
      changeRequestTitle: 'Review-ready change',
      changeRequestBody: 'Validated at the real Git boundary.',
      draft: true,
    })

    expect(result).toMatchObject({
      ok: true,
      branch: { status: 'created', name: 'codex/review-ready' },
      changeRequest: { state: 'draft' },
    })
    expect(openChangeRequest).toHaveBeenCalledWith(
      repository,
      expect.objectContaining({
        headRef: 'codex/review-ready',
        baseRef: 'main',
        title: 'Review-ready change',
        body: 'Validated at the real Git boundary.',
        draft: true,
      }),
    )
    expect(await git(repository, ['log', '-1', '--format=%s'])).toBe('Ship review-ready change')
    expect(await git(remote, ['show-ref', '--verify', 'refs/heads/codex/review-ready'])).toContain(
      'refs/heads/codex/review-ready',
    )
  })
})
