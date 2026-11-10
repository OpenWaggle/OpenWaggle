import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { localPushGit, planPrePush } from '../pre-push'

const directory = mkdtempSync(path.join(tmpdir(), 'pre-push-'))

function git(...args: string[]) {
  return execFileSync(
    'git',
    ['-c', 'user.name=Tests', '-c', 'user.email=tests@openwaggle.ai', ...args],
    {
      cwd: directory,
      encoding: 'utf8',
    },
  ).trim()
}

function commit(message: string) {
  writeFileSync(path.join(directory, 'file.txt'), `${message}\n`)
  git('add', 'file.txt')
  git('commit', '-q', '-m', message)
  return git('rev-parse', 'HEAD')
}

afterAll(() => {
  rmSync(directory, { recursive: true, force: true })
})

describe('pre-push against a real repository', () => {
  git('init', '-q', '-b', 'feature')
  const base = commit('feat: base')
  const pushed = commit('feat: pushed')
  git('reset', '-q', '--hard', base)
  const amended = commit('feat: amended')
  const gitInRepository = localPushGit(directory)

  it('lets a fast-forward through', () => {
    const plan = planPrePush(
      [
        {
          localRef: 'refs/heads/feature',
          localSha: pushed,
          remoteRef: 'refs/heads/feature',
          remoteSha: base,
        },
      ],
      gitInRepository,
    )
    expect(plan).toEqual({ kind: 'run', script: 'verify' })
  })

  it('refuses an amended commit pushed over the published one', () => {
    const plan = planPrePush(
      [
        {
          localRef: 'refs/heads/feature',
          localSha: amended,
          remoteRef: 'refs/heads/feature',
          remoteSha: pushed,
        },
      ],
      gitInRepository,
    )
    expect(plan).toMatchObject({ kind: 'reject' })
  })
})
