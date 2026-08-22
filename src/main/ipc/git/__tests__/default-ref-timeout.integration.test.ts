import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer, type Server, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveDefaultBranchRevision } from '../default-ref'

const execFileAsync = promisify(execFile)
let repositoryPath: string | null = null
let hangingServer: Server | null = null
/** Sockets have to be destroyed by hand: `close()` waits for open connections, so teardown hangs. */
let hangingSockets: Socket[] = []

/** Comfortably above the resolver's own bound, well below a git connect timeout. */
const MAX_ACCEPTABLE_MS = 15_000

async function git(cwd: string, args: readonly string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', [...args], { cwd })
  return stdout
}

/**
 * A local listener that accepts a connection and never answers.
 *
 * Deterministic, and a property of the fixture rather than of the network. The previous version pointed
 * the remote at `10.255.255.1` and assumed those packets would be black-holed: that is RFC1918 space,
 * so on a machine that routes it - or a runner that rejects it immediately - the connection fails fast
 * and the assertions below pass whether or not the call is bounded. The test then could not tell the
 * fix from its absence.
 */
async function startHangingServer(): Promise<number> {
  const server = createServer((socket) => {
    // Accept and hold: never write a response, never close.
    hangingSockets.push(socket)
  })
  hangingServer = server
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('expected a TCP address')
  return address.port
}

afterEach(async () => {
  if (repositoryPath) await rm(repositoryPath, { recursive: true, force: true })
  repositoryPath = null
  for (const socket of hangingSockets) socket.destroy()
  hangingSockets = []
  if (hangingServer) {
    await new Promise<void>((resolve) => {
      hangingServer?.close(() => resolve())
    })
    hangingServer = null
  }
})

describe('default ref resolution against an unresponsive remote', () => {
  it('gives up quickly instead of blocking the caller', async () => {
    /*
     * Resolution asks the remote when the local `origin/HEAD` symref is missing, which is the normal
     * state of a repository created with `git init` + `git remote add`. That call sits on interactive
     * paths - an Automatic-scope diff load, the short-TTL local status, and the gate a Commit & push
     * waits for - and without a bound it blocked indefinitely: verified against an unresponsive remote,
     * still stuck after 60s. It must fall through to the conventional local default instead.
     */
    const repository = await mkdtemp(path.join(tmpdir(), 'openwaggle-unresponsive-remote-'))
    repositoryPath = repository
    await git(repository, ['init', '--initial-branch=main'])
    await git(repository, ['config', 'user.name', 'OpenWaggle Test'])
    await git(repository, ['config', 'user.email', 'openwaggle@example.test'])
    await writeFile(path.join(repository, 'seed.txt'), 'seed\n')
    await git(repository, ['add', '--all'])
    await git(repository, ['commit', '-m', 'chore: baseline'])

    const port = await startHangingServer()
    await git(repository, [
      'remote',
      'add',
      'origin',
      `git://127.0.0.1:${String(port)}/unresponsive.git`,
    ])

    const startedAt = Date.now()
    const resolved = await resolveDefaultBranchRevision(repository)
    const elapsed = Date.now() - startedAt

    expect(elapsed).toBeLessThan(MAX_ACCEPTABLE_MS)
    // Falls through to the conventional local default rather than failing.
    expect(resolved).toBe('main')
  })
})
