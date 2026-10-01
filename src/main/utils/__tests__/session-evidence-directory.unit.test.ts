import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  preparedSessionEvidenceDirectory,
  prepareSessionEvidenceDirectory,
  sessionEvidenceDirectoryFor,
  sessionEvidenceRoot,
} from '../session-evidence-directory'
import {
  prepareSessionScratchDirectory,
  removeSessionScratchDirectory,
  retainSessionScratchDirectory,
  sessionScratchRoot,
} from '../session-scratch-directory'
import { sweepSessionScratchDirectories } from '../session-scratch-sweep'

const EIGHT_DAYS_MS = 8 * 24 * 60 * 60 * 1000
const OWNER_ONLY = 0o700
const PERMISSION_BITS = 0o777
const posixOnly = process.platform === 'win32' ? it.skip : it

describe('Session evidence directory', () => {
  let temporaryDirectory = ''
  let root = ''

  beforeEach(async () => {
    temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-evidence-test-'))
    root = sessionScratchRoot(temporaryDirectory)
  })

  afterEach(async () => {
    await fs.rm(temporaryDirectory, { recursive: true, force: true })
  })

  it("sits inside the profile namespace, named like the Session's scratch directory", async () => {
    const scratch = await prepareSessionScratchDirectory('session-a', root)

    expect(sessionEvidenceDirectoryFor(scratch)).toBe(
      path.join(root, 'evidence', path.basename(scratch)),
    )
    expect(sessionEvidenceRoot(root)).toBe(path.join(root, 'evidence'))
  })

  posixOnly('is created owner-only and survives archiving the Session', async () => {
    const scratch = await prepareSessionScratchDirectory('session-a', root)
    const evidence = await prepareSessionEvidenceDirectory(scratch)
    await fs.writeFile(path.join(evidence, 'final.png'), 'png')

    await removeSessionScratchDirectory('session-a', root)

    expect((await fs.stat(evidence)).mode & PERMISSION_BITS).toBe(OWNER_ONLY)
    await expect(fs.readFile(path.join(evidence, 'final.png'), 'utf8')).resolves.toBe('png')
    await expect(fs.access(scratch)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  posixOnly('refuses a symlink planted in place of the evidence root', async () => {
    const scratch = await prepareSessionScratchDirectory('session-a', root)
    const elsewhere = path.join(temporaryDirectory, 'elsewhere')
    await fs.mkdir(elsewhere)
    await fs.symlink(elsewhere, sessionEvidenceRoot(root))

    await expect(prepareSessionEvidenceDirectory(scratch)).rejects.toThrow('not a real directory')
  })

  it('is kept by the sweep while in use and removed after a week without new evidence', async () => {
    const scratch = await prepareSessionScratchDirectory('session-a', root)
    const evidence = await prepareSessionEvidenceDirectory(scratch)

    await sweepSessionScratchDirectories([], root, Date.now())
    expect((await fs.stat(evidence)).isDirectory()).toBe(true)

    await sweepSessionScratchDirectories([], root, Date.now() + EIGHT_DAYS_MS)
    await expect(fs.access(evidence)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('marks the evidence directory as used on every Run, so the sweep keeps it', async () => {
    const scratch = await prepareSessionScratchDirectory('session-a', root)
    const evidence = await prepareSessionEvidenceDirectory(scratch)
    const old = new Date(Date.now() - EIGHT_DAYS_MS)
    await fs.utimes(evidence, old, old)

    await prepareSessionEvidenceDirectory(scratch)
    await sweepSessionScratchDirectories([], root, Date.now())

    expect((await fs.stat(evidence)).isDirectory()).toBe(true)
  })

  it('keeps recent evidence in nested folders when the namespace sweep runs', async () => {
    const scratch = await prepareSessionScratchDirectory('session-a', root)
    const evidence = await prepareSessionEvidenceDirectory(scratch)
    await fs.mkdir(path.join(evidence, 'run-1'))
    await fs.writeFile(path.join(evidence, 'run-1', 'final.png'), 'png')
    // The evidence root and the Session's folder look old; only the nested folder is new.
    const old = new Date(Date.now() - EIGHT_DAYS_MS)
    await fs.utimes(evidence, old, old)
    await fs.utimes(sessionEvidenceRoot(root), old, old)

    await sweepSessionScratchDirectories([], root, Date.now())

    await expect(fs.readFile(path.join(evidence, 'run-1', 'final.png'), 'utf8')).resolves.toBe(
      'png',
    )
  })

  posixOnly('never prunes through a symlink planted as the evidence root', async () => {
    await prepareSessionScratchDirectory('session-a', root)
    const victim = path.join(temporaryDirectory, 'victim')
    const project = path.join(victim, 'old-project')
    await fs.mkdir(project, { recursive: true })
    const old = new Date(Date.now() - EIGHT_DAYS_MS * 2)
    await fs.utimes(project, old, old)
    await fs.symlink(victim, sessionEvidenceRoot(root))

    await sweepSessionScratchDirectories([], root, Date.now())

    expect((await fs.stat(project)).isDirectory()).toBe(true)
  })

  it('reports an evidence directory only once it was prepared', async () => {
    const scratch = await prepareSessionScratchDirectory('session-a', root)
    expect(preparedSessionEvidenceDirectory(scratch)).toBeUndefined()

    const evidence = await prepareSessionEvidenceDirectory(scratch)
    expect(preparedSessionEvidenceDirectory(scratch)).toBe(evidence)
  })

  posixOnly('does not report an evidence directory whose preparation was refused', async () => {
    const scratch = await prepareSessionScratchDirectory('session-a', root)
    const shared = path.join(temporaryDirectory, 'shared')
    await fs.mkdir(path.join(shared, path.basename(scratch)), { recursive: true })
    await fs.symlink(shared, sessionEvidenceRoot(root))

    await expect(prepareSessionEvidenceDirectory(scratch)).rejects.toThrow('not a real directory')
    expect(preparedSessionEvidenceDirectory(scratch)).toBeUndefined()
  })

  posixOnly('does not report a regular file planted as the evidence directory', async () => {
    const scratch = await prepareSessionScratchDirectory('session-a', root)
    await fs.mkdir(sessionEvidenceRoot(root), { mode: OWNER_ONLY })
    await fs.writeFile(sessionEvidenceDirectoryFor(scratch), 'not a directory')

    await expect(prepareSessionEvidenceDirectory(scratch)).rejects.toThrow('not a real directory')
    expect(preparedSessionEvidenceDirectory(scratch)).toBeUndefined()
  })

  it('stops reporting an evidence directory that was removed after it was prepared', async () => {
    const scratch = await prepareSessionScratchDirectory('session-a', root)
    const evidence = await prepareSessionEvidenceDirectory(scratch)
    await fs.rm(evidence, { recursive: true })

    expect(preparedSessionEvidenceDirectory(scratch)).toBeUndefined()
  })

  posixOnly('does not report a directory whose ownership check failed', async () => {
    const scratch = await prepareSessionScratchDirectory('session-a', root)
    await fs.mkdir(sessionEvidenceDirectoryFor(scratch), { recursive: true, mode: OWNER_ONLY })
    const owner = (await fs.stat(scratch)).uid
    // Every level is a real directory, but the check sees another user's.
    const getuid = vi.spyOn(process, 'getuid').mockReturnValue(owner + 1)
    try {
      await expect(prepareSessionEvidenceDirectory(scratch)).rejects.toThrow('another user')
    } finally {
      getuid.mockRestore()
    }

    expect(preparedSessionEvidenceDirectory(scratch)).toBeUndefined()
  })

  posixOnly('stops reporting an evidence directory later replaced by a file', async () => {
    const scratch = await prepareSessionScratchDirectory('session-a', root)
    const evidence = await prepareSessionEvidenceDirectory(scratch)
    await fs.rm(evidence, { recursive: true })
    await fs.writeFile(evidence, 'not a directory')

    expect(preparedSessionEvidenceDirectory(scratch)).toBeUndefined()
  })

  it('keeps week-old evidence of a Session whose Run just started', async () => {
    const scratch = await prepareSessionScratchDirectory('session-a', root)
    const evidence = await prepareSessionEvidenceDirectory(scratch)
    const release = retainSessionScratchDirectory('session-a', root)
    try {
      await sweepSessionScratchDirectories(['session-a'], root, Date.now() + EIGHT_DAYS_MS)
      expect((await fs.stat(evidence)).isDirectory()).toBe(true)
    } finally {
      await release()
    }
  })

  it('lets a Run that starts during the startup prune keep its evidence directory', async () => {
    const scratch = await prepareSessionScratchDirectory('session-a', root)
    const evidence = await prepareSessionEvidenceDirectory(scratch)
    const old = new Date(Date.now() - EIGHT_DAYS_MS)
    await fs.utimes(evidence, old, old)
    const rm = fs.rm.bind(fs)
    const removalMayFinish = Promise.withResolvers<void>()
    const spy = vi.spyOn(fs, 'rm').mockImplementation(async (target, options) => {
      if (target === evidence) await removalMayFinish.promise
      return rm(target, options)
    })
    try {
      const sweeping = sweepSessionScratchDirectories(['session-a'], root, Date.now())
      await vi.waitFor(() => expect(spy).toHaveBeenCalledWith(evidence, expect.anything()))
      // The Session's Run starts while the prune is still removing its week-old evidence.
      const release = retainSessionScratchDirectory('session-a', root)
      const preparing = prepareSessionEvidenceDirectory(scratch)
      removalMayFinish.resolve()
      await Promise.all([sweeping, preparing])
      release()

      expect((await fs.stat(evidence)).isDirectory()).toBe(true)
      expect(preparedSessionEvidenceDirectory(scratch)).toBe(evidence)
    } finally {
      spy.mockRestore()
    }
  })
})
