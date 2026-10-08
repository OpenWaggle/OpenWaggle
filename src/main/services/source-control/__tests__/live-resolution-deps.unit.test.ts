import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { forgetRemoteRefProbes, probeRemoteChangeRequestRefs } from '../live-resolution-deps'

function git(cwd: string, ...args: string[]) {
  return execFileSync('git', args, { cwd, encoding: 'utf-8' }).trim()
}

let root: string

function repositoryWithRemote(ref: string | null) {
  const remote = join(root, `remote-${Math.random().toString(36).slice(2)}.git`)
  const work = join(root, `work-${Math.random().toString(36).slice(2)}`)
  git(root, 'init', '--bare', '--quiet', remote)
  git(root, 'init', '--quiet', work)
  git(work, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '--allow-empty', '-qm', 'init')
  git(work, 'remote', 'add', 'origin', remote)
  git(work, 'push', '--quiet', 'origin', 'HEAD:refs/heads/main')
  if (ref) git(work, 'push', '--quiet', 'origin', `HEAD:${ref}`)
  return { work, remote }
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ow-probe-'))
  forgetRemoteRefProbes()
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('reading change-request refs from a remote', () => {
  it.each([
    ['refs/pull/7/head', 'github'],
    ['refs/merge-requests/7/head', 'gitlab'],
    [null, null],
  ])('recognises %s', async (ref, provider) => {
    const { work } = repositoryWithRemote(ref)

    await expect(probeRemoteChangeRequestRefs(work, 'origin')).resolves.toBe(provider)
  })

  it('remembers an answer for a while instead of asking the remote on every refresh', async () => {
    const { work } = repositoryWithRemote(null)
    await expect(probeRemoteChangeRequestRefs(work, 'origin')).resolves.toBeNull()
    git(work, 'push', '--quiet', 'origin', 'HEAD:refs/pull/1/head')

    await expect(probeRemoteChangeRequestRefs(work, 'origin')).resolves.toBeNull()
  })
})
