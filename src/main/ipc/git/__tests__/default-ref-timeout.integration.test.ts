import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveDefaultBranchRevision } from '../default-ref'

const execFileAsync = promisify(execFile)
let repositoryPath: string | null = null

/** Comfortably above the resolver's own bound, well below a git connect timeout. */
const MAX_ACCEPTABLE_MS = 15_000

async function git(cwd: string, args: readonly string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', [...args], { cwd })
  return stdout
}

afterEach(async () => {
  if (repositoryPath) await rm(repositoryPath, { recursive: true, force: true })
  repositoryPath = null
})

describe('default ref resolution against an unreachable remote', () => {
  it('gives up quickly instead of blocking the caller', async () => {
    /*
     * Resolution asks the remote when the local `origin/HEAD` symref is missing, which is the normal
     * state of a repository created with `git init` + `git remote add`. That call sits on interactive
     * paths - an Automatic-scope diff load, the short-TTL local status, and the gate a Commit & push
     * waits for - and without a bound it blocked indefinitely: verified against an unreachable
     * origin, still stuck after 15s. It must fall through to the conventional local default instead.
     */
    const repository = await mkdtemp(path.join(tmpdir(), 'openwaggle-unreachable-remote-'))
    repositoryPath = repository
    await git(repository, ['init', '--initial-branch=main'])
    await git(repository, ['config', 'user.name', 'OpenWaggle Test'])
    await git(repository, ['config', 'user.email', 'openwaggle@example.test'])
    await writeFile(path.join(repository, 'seed.txt'), 'seed\n')
    await git(repository, ['add', '--all'])
    await git(repository, ['commit', '-m', 'chore: baseline'])
    // A routable-but-dead address, so the connection attempt hangs rather than failing instantly.
    await git(repository, ['remote', 'add', 'origin', 'https://10.255.255.1/unreachable.git'])

    const startedAt = Date.now()
    const resolved = await resolveDefaultBranchRevision(repository)
    const elapsed = Date.now() - startedAt

    expect(elapsed).toBeLessThan(MAX_ACCEPTABLE_MS)
    // Falls through to the conventional local default rather than failing.
    expect(resolved).toBe('main')
  })
})
