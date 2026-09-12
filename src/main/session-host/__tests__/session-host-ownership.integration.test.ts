import { type ChildProcess, spawn } from 'node:child_process'
import { once } from 'node:events'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getSafeChildEnv } from '../../env'
import { acquireSessionHostOwnership, type SessionHostOwnership } from '../session-host-ownership'

const BLOCKED_OWNER_PROCESS = `
  import(process.argv[1]).then(async ({ acquireSessionHostOwnership }) => {
    const ownership = await acquireSessionHostOwnership(process.argv[2]);
    process.stdout.write('owned\\n');
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
    await ownership.release();
  }).catch((error) => { process.stderr.write(String(error)); process.exitCode = 1; });
`

describe('Session Host ownership', () => {
  let temporaryRoot = ''
  const ownerships: SessionHostOwnership[] = []
  const children: ChildProcess[] = []

  async function startBlockedOwner(targetPath: string) {
    const child = spawn(
      process.execPath,
      [
        '-e',
        BLOCKED_OWNER_PROCESS,
        new URL('../session-host-ownership.ts', import.meta.url).href,
        targetPath,
      ],
      { env: getSafeChildEnv(), stdio: ['ignore', 'pipe', 'pipe'] },
    )
    children.push(child)
    await new Promise<void>((resolve, reject) => {
      let stderr = ''
      child.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString()
      })
      child.once('error', reject)
      child.once('exit', (code) =>
        reject(new Error(`Owner exited before acquisition: ${code}. ${stderr}`)),
      )
      child.stdout?.once('data', () => resolve())
    })
    return child
  }

  async function killOwner(child: ChildProcess) {
    if (child.exitCode !== null || child.signalCode !== null) return
    const exited = once(child, 'exit')
    child.kill('SIGKILL')
    await exited
  }

  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-host-ownership-'))
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await Promise.all(children.splice(0).map(killOwner))
    for (const ownership of ownerships.splice(0)) await ownership.release()
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  it('permits one owner, rejects a second owner, and transfers only after explicit release', async () => {
    const targetPath = path.join(temporaryRoot, 'session-host.sqlite')
    const first = await acquireSessionHostOwnership(targetPath)
    ownerships.push(first)

    await expect(acquireSessionHostOwnership(targetPath)).rejects.toMatchObject({ code: 'ELOCKED' })
    await first.release()

    const second = await acquireSessionHostOwnership(targetPath)
    ownerships.push(second)
    await expect(second.release()).resolves.toBeUndefined()
    await expect(second.release()).resolves.toBeUndefined()
  })

  it('does not mistake a successor acquired during release for the previous owner', async () => {
    const targetPath = path.join(temporaryRoot, 'handoff.sqlite')
    const first = await acquireSessionHostOwnership(targetPath)
    ownerships.push(first)

    const releasing = first.release()
    const successor = acquireSessionHostOwnership(targetPath)
    const [, second] = await Promise.all([releasing, successor])
    ownerships.push(second)

    await expect(first.release()).resolves.toBeUndefined()
    await expect(second.release()).resolves.toBeUndefined()
  })

  it('reclaims ownership immediately after a separate owner process crashes', async () => {
    const targetPath = path.join(temporaryRoot, 'crashed-host.sqlite')
    const child = await startBlockedOwner(targetPath)
    await expect(acquireSessionHostOwnership(targetPath, { timeoutMs: 0 })).rejects.toMatchObject({
      code: 'ELOCKED',
    })

    await killOwner(child)

    const recovered = await acquireSessionHostOwnership(targetPath, { timeoutMs: 0 })
    ownerships.push(recovered)
    await expect(acquireSessionHostOwnership(targetPath, { timeoutMs: 0 })).rejects.toMatchObject({
      code: 'ELOCKED',
    })
  })

  it('keeps a live owner whose event loop cannot refresh a heartbeat', async () => {
    const targetPath = path.join(temporaryRoot, 'blocked-host.sqlite')
    await startBlockedOwner(targetPath)
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 60 * 60_000)

    await expect(acquireSessionHostOwnership(targetPath, { timeoutMs: 0 })).rejects.toMatchObject({
      code: 'ELOCKED',
    })
  })

  it('does not replace an invalid ownership database to manufacture a new owner', async () => {
    const targetPath = path.join(temporaryRoot, 'invalid-host.sqlite')
    const ownershipPath = `${targetPath}.ownership.sqlite`
    await fs.writeFile(ownershipPath, 'invalid ownership data')

    await expect(acquireSessionHostOwnership(targetPath, { timeoutMs: 0 })).rejects.toThrow()
    expect(await fs.readFile(ownershipPath, 'utf8')).toBe('invalid ownership data')
  })
})
