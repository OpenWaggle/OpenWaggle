import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  HOST_TEMPORARY_DIRECTORY_ENV,
  hostTemporaryDirectory,
  prepareSessionScratchDirectory,
  removeSessionScratchDirectory,
  retainSessionScratchDirectory,
  sessionScratchDirectoryPath,
  sessionScratchEnvironment,
  sessionScratchRoot,
} from '../session-scratch-directory'

const OWNER_ONLY = 0o700
/** macOS limits a Unix socket path to 104 bytes; leave room for names like `tsx-501/12345.pipe`. */
const SOCKET_ROOM_SCRATCH_PATH_BYTES = 48
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

  posixOnly('keeps the default path short enough for Unix sockets under TMPDIR', () => {
    const directory = sessionScratchDirectoryPath('3557992e-9fa2-48bb-b462-84e59638207c')

    expect(directory.startsWith('/tmp/')).toBe(true)
    expect(Buffer.byteLength(directory, 'utf8')).toBeLessThanOrEqual(SOCKET_ROOM_SCRATCH_PATH_BYTES)
  })

  it('never lets a Session id escape the root', () => {
    for (const sessionId of ['../escape', 'a/b', '.hidden']) {
      expect(path.dirname(sessionScratchDirectoryPath(sessionId, root))).toBe(root)
    }
    expect(() => sessionScratchDirectoryPath('', root)).toThrow('Session id is required')
  })

  it('defers an archive removal until the Run using the directory ends', async () => {
    const directory = await prepareSessionScratchDirectory('session-a', root)
    const release = retainSessionScratchDirectory('session-a', root)
    await fs.writeFile(path.join(directory, 'build.log'), 'in use')

    await removeSessionScratchDirectory('session-a', root)
    await expect(fs.readFile(path.join(directory, 'build.log'), 'utf8')).resolves.toBe('in use')

    await release()
    await expect(fs.access(directory)).rejects.toThrow()
  })

  it('drops a deferred removal when the Session runs again before the Run ends', async () => {
    const directory = await prepareSessionScratchDirectory('session-a', root)
    const release = retainSessionScratchDirectory('session-a', root)
    await removeSessionScratchDirectory('session-a', root)

    await prepareSessionScratchDirectory('session-a', root)
    await release()

    expect((await fs.stat(directory)).isDirectory()).toBe(true)
  })

  it('prefers the preserved Host temp directory inside a tool process', () => {
    expect(hostTemporaryDirectory('/var/folders/host/T')).toBe('/var/folders/host/T')
    expect(hostTemporaryDirectory('')).toBe(os.tmpdir())
  })

  it('exports the directory through every common temp variable', () => {
    expect(sessionScratchEnvironment('/scratch/session-a')).toEqual({
      TMPDIR: '/scratch/session-a',
      TMP: '/scratch/session-a',
      TEMP: '/scratch/session-a',
      [HOST_TEMPORARY_DIRECTORY_ENV]: hostTemporaryDirectory(),
    })
  })
})
