import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  prepareSessionScratchDirectory,
  removeSessionScratchDirectory,
  sessionScratchDirectoryPath,
  sessionScratchEnvironment,
  sessionScratchRoot,
} from '../session-scratch-directory'

const OWNER_ONLY = 0o700
const PERMISSION_BITS = 0o777
const posixOnly = process.platform === 'win32' ? it.skip : it

describe('Session scratch directory', () => {
  let temporaryDirectory = ''
  let root = ''

  beforeEach(async () => {
    temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-scratch-test-'))
    root = sessionScratchRoot(temporaryDirectory)
  })

  afterEach(async () => {
    await fs.rm(temporaryDirectory, { recursive: true, force: true })
  })

  it('gives concurrent Sessions different directories that cannot see each other', async () => {
    const [first, second] = await Promise.all([
      prepareSessionScratchDirectory('session-a', root),
      prepareSessionScratchDirectory('session-b', root),
    ])

    expect(first).not.toBe(second)
    expect(path.dirname(first)).toBe(root)
    expect(sessionScratchEnvironment(first).TMPDIR).not.toBe(
      sessionScratchEnvironment(second).TMPDIR,
    )
    await fs.writeFile(path.join(first, 'push.log'), 'session a output')
    await expect(fs.readdir(second)).resolves.toEqual([])
  })

  posixOnly('creates the root and the Session directory owner-only', async () => {
    const directory = await prepareSessionScratchDirectory('session-a', root)

    expect((await fs.stat(root)).mode & PERMISSION_BITS).toBe(OWNER_ONLY)
    expect((await fs.stat(directory)).mode & PERMISSION_BITS).toBe(OWNER_ONLY)
  })

  posixOnly('tightens an existing directory that was left readable by others', async () => {
    const directory = sessionScratchDirectoryPath('session-a', root)
    await fs.mkdir(directory, { recursive: true, mode: 0o755 })
    await fs.chmod(directory, 0o755)

    await prepareSessionScratchDirectory('session-a', root)

    expect((await fs.stat(directory)).mode & PERMISSION_BITS).toBe(OWNER_ONLY)
  })

  posixOnly('refuses a symlink planted in place of the Session directory', async () => {
    const elsewhere = path.join(temporaryDirectory, 'elsewhere')
    await fs.mkdir(elsewhere)
    await fs.mkdir(root, { mode: OWNER_ONLY })
    await fs.symlink(elsewhere, sessionScratchDirectoryPath('session-a', root))

    await expect(prepareSessionScratchDirectory('session-a', root)).rejects.toThrow(
      'not a real directory',
    )
  })

  it('keeps the directory and its files across runs of the same Session', async () => {
    const directory = await prepareSessionScratchDirectory('session-a', root)
    await fs.writeFile(path.join(directory, 'plan.txt'), 'kept')

    await expect(prepareSessionScratchDirectory('session-a', root)).resolves.toBe(directory)
    await expect(fs.readFile(path.join(directory, 'plan.txt'), 'utf8')).resolves.toBe('kept')
  })

  it('removes the directory and everything in it, and tolerates a missing one', async () => {
    const directory = await prepareSessionScratchDirectory('session-a', root)
    await fs.mkdir(path.join(directory, 'nested'))
    await fs.writeFile(path.join(directory, 'nested', 'state.tfstate'), 'secret')

    await removeSessionScratchDirectory('session-a', root)
    await expect(fs.access(directory)).rejects.toThrow()
    await expect(removeSessionScratchDirectory('session-a', root)).resolves.toBeUndefined()
  })

  it('recreates the directory after a removal that was still in flight', async () => {
    await prepareSessionScratchDirectory('session-a', root)
    const removal = removeSessionScratchDirectory('session-a', root)
    const directory = await prepareSessionScratchDirectory('session-a', root)
    await removal

    await expect(fs.stat(directory)).resolves.toMatchObject({})
    expect((await fs.stat(directory)).isDirectory()).toBe(true)
  })

  it.each(['../escape', 'a/b', '', '.hidden'])('rejects the unsafe Session id %j', (sessionId) => {
    expect(() => sessionScratchDirectoryPath(sessionId, root)).toThrow('not a valid scratch')
  })

  it('exports the directory through every common temp variable', () => {
    expect(sessionScratchEnvironment('/scratch/session-a')).toEqual({
      TMPDIR: '/scratch/session-a',
      TMP: '/scratch/session-a',
      TEMP: '/scratch/session-a',
    })
  })
})
