import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  preparedSessionEvidenceDirectory,
  prepareSessionEvidenceDirectory,
  sessionEvidenceDirectoryFor,
  sessionEvidenceRoot,
} from '../session-evidence-directory'
import {
  prepareSessionScratchDirectory,
  removeSessionScratchDirectory,
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

  it('sits beside the profile namespaces, named like the scratch directory', async () => {
    const scratch = await prepareSessionScratchDirectory('session-a', root)

    expect(sessionEvidenceDirectoryFor(scratch)).toBe(
      path.join(path.dirname(root), 'evidence', path.basename(scratch)),
    )
    expect(sessionEvidenceRoot(root)).toBe(path.join(path.dirname(root), 'evidence'))
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
})
