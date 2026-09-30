import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  configureSessionScratchNamespace,
  markSessionScratchNamespace,
  prepareSessionScratchDirectory,
  retainSessionScratchDirectory,
  sessionScratchRoot,
} from '../session-scratch-directory'
import { sweepSessionScratchDirectories } from '../session-scratch-sweep'

const TWO_HOURS_MS = 2 * 60 * 60 * 1000
const EIGHT_DAYS_MS = 8 * 24 * 60 * 60 * 1000

const missing = { code: 'ENOENT' }
const posixOnly = process.platform === 'win32' ? it.skip : it

const namespaceRestores: (() => void)[] = []

function useNamespace(userDataRoot: string) {
  namespaceRestores.push(configureSessionScratchNamespace(userDataRoot))
}

describe('Session scratch sweep', () => {
  let temporaryDirectory = ''
  let root = ''

  beforeEach(async () => {
    temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-scratch-sweep-test-'))
    root = sessionScratchRoot(temporaryDirectory)
  })

  afterEach(async () => {
    // Some tests switch the namespace; put back whatever the module had before them.
    for (const restore of namespaceRestores.splice(0).reverse()) restore()
    await fs.rm(temporaryDirectory, { recursive: true, force: true })
  })

  it('sweeps directories of Sessions that are gone and keeps live, young, and running ones', async () => {
    const [live, gone, running] = await Promise.all([
      prepareSessionScratchDirectory('session-live', root),
      prepareSessionScratchDirectory('session-gone', root),
      prepareSessionScratchDirectory('session-running', root),
    ])
    const release = retainSessionScratchDirectory('session-running', root)

    await expect(sweepSessionScratchDirectories(['session-live'], root, Date.now())).resolves.toBe(
      0,
    )
    await expect(
      sweepSessionScratchDirectories(['session-live'], root, Date.now() + TWO_HOURS_MS),
    ).resolves.toBe(1)

    await expect(fs.access(gone)).rejects.toMatchObject(missing)
    expect((await fs.stat(live)).isDirectory()).toBe(true)
    expect((await fs.stat(running)).isDirectory()).toBe(true)
    await release()
  })

  it('keeps a directory a Run retained while the sweep was reading it', async () => {
    const directory = await prepareSessionScratchDirectory('session-racing', root)
    const lstat = fs.lstat.bind(fs)
    let release: (() => Promise<void>) | undefined
    const spy = vi.spyOn(fs, 'lstat').mockImplementation(async (target, options) => {
      const stats = await lstat(target, options)
      // The Session is unarchived and its Run starts while the sweep awaits this lstat.
      if (target === directory && !release) {
        release = retainSessionScratchDirectory('session-racing', root)
      }
      return stats
    })
    try {
      await expect(
        sweepSessionScratchDirectories([], root, Date.now() + TWO_HOURS_MS),
      ).resolves.toBe(0)
    } finally {
      spy.mockRestore()
    }

    expect((await fs.stat(directory)).isDirectory()).toBe(true)
    await release?.()
  })

  it("removes another profile's namespace once that profile is gone, never while it exists", async () => {
    const kept = path.join(temporaryDirectory, 'profiles', 'kept')
    const throwaway = path.join(temporaryDirectory, 'profiles', 'throwaway')
    await Promise.all([
      fs.mkdir(kept, { recursive: true }),
      fs.mkdir(throwaway, { recursive: true }),
    ])
    useNamespace(kept)
    const keptRoot = sessionScratchRoot(temporaryDirectory)
    await prepareSessionScratchDirectory('session-kept', keptRoot)
    useNamespace(throwaway)
    const throwawayRoot = sessionScratchRoot(temporaryDirectory)
    await prepareSessionScratchDirectory('session-throwaway', throwawayRoot)
    useNamespace(path.join(temporaryDirectory, 'profiles', 'own'))
    const ownRoot = sessionScratchRoot(temporaryDirectory)
    await prepareSessionScratchDirectory('session-own', ownRoot)

    // A profile closed for more than a week still exists, so its Sessions keep their files.
    await sweepSessionScratchDirectories(['session-own'], ownRoot, Date.now() + EIGHT_DAYS_MS)
    expect((await fs.stat(keptRoot)).isDirectory()).toBe(true)
    expect((await fs.stat(throwawayRoot)).isDirectory()).toBe(true)

    await fs.rm(throwaway, { recursive: true })
    await sweepSessionScratchDirectories(['session-own'], ownRoot, Date.now())
    expect((await fs.stat(throwawayRoot)).isDirectory()).toBe(true)
    await sweepSessionScratchDirectories(['session-own'], ownRoot, Date.now() + TWO_HOURS_MS)
    await expect(fs.access(throwawayRoot)).rejects.toMatchObject(missing)
    expect((await fs.stat(keptRoot)).isDirectory()).toBe(true)
    expect((await fs.stat(ownRoot)).isDirectory()).toBe(true)
  })

  it('marks a fresh namespace once when several Sessions prepare it at the same time', async () => {
    const profile = path.join(temporaryDirectory, 'profiles', 'parallel')
    await fs.mkdir(profile, { recursive: true })
    useNamespace(profile)
    const namespace = sessionScratchRoot(temporaryDirectory)
    const sessions = ['session-1', 'session-2', 'session-3', 'session-4']

    await Promise.all(sessions.map((id) => prepareSessionScratchDirectory(id, namespace)))
    await fs.rm(path.join(namespace, '.owner'))
    // Concurrent markers of an unmarked namespace each succeed rather than racing on one file.
    await expect(
      Promise.all(sessions.map(() => markSessionScratchNamespace(namespace))),
    ).resolves.toHaveLength(sessions.length)

    await expect(fs.readFile(path.join(namespace, '.owner'), 'utf8')).resolves.toBe(`${profile}\n`)
    const leftovers = (await fs.readdir(namespace)).filter((name) => name.endsWith('.tmp'))
    expect(leftovers).toEqual([])
  })

  it('marks a namespace again when it was removed while the Host ran', async () => {
    const profile = path.join(temporaryDirectory, 'profiles', 'recreated')
    await fs.mkdir(profile, { recursive: true })
    useNamespace(profile)
    const namespace = sessionScratchRoot(temporaryDirectory)
    await prepareSessionScratchDirectory('session-first', namespace)
    await fs.rm(namespace, { recursive: true })

    await prepareSessionScratchDirectory('session-second', namespace)

    await expect(fs.readFile(path.join(namespace, '.owner'), 'utf8')).resolves.toBe(`${profile}\n`)
  })

  it.each([
    ['an empty', ''],
    ['a partial', '/Users/me/Library/Applica'],
    ['a relative', 'profiles/kept\n'],
  ])('treats %s owner marker as unmarked', async (_kind, marker) => {
    const damagedRoot = path.join(path.dirname(root), 'damaged')
    await prepareSessionScratchDirectory('session-own', root)
    await fs.mkdir(path.join(damagedRoot, 'session'), { recursive: true, mode: 0o700 })
    await fs.writeFile(path.join(damagedRoot, '.owner'), marker)

    await sweepSessionScratchDirectories(['session-own'], root, Date.now() + TWO_HOURS_MS)
    expect((await fs.stat(damagedRoot)).isDirectory()).toBe(true)
    await sweepSessionScratchDirectories(['session-own'], root, Date.now() + EIGHT_DAYS_MS)
    await expect(fs.access(damagedRoot)).rejects.toMatchObject(missing)
  })

  it('removes an unmarked namespace of another profile only after a week without a Run', async () => {
    const unmarkedRoot = path.join(path.dirname(root), 'unmarked')
    await prepareSessionScratchDirectory('session-own', root)
    await fs.mkdir(path.join(unmarkedRoot, 'session'), { recursive: true, mode: 0o700 })

    await sweepSessionScratchDirectories(['session-own'], root, Date.now() + TWO_HOURS_MS)
    expect((await fs.stat(unmarkedRoot)).isDirectory()).toBe(true)
    await sweepSessionScratchDirectories(['session-own'], root, Date.now() + EIGHT_DAYS_MS)
    await expect(fs.access(unmarkedRoot)).rejects.toMatchObject(missing)
  })

  posixOnly(
    'never follows a symlinked user directory or namespace into files it must keep',
    async () => {
      const victim = path.join(temporaryDirectory, 'victim-projects')
      const project = path.join(victim, 'old-project')
      await fs.mkdir(project, { recursive: true })
      const old = new Date(Date.now() - EIGHT_DAYS_MS * 2)
      await fs.utimes(project, old, old)
      await fs.utimes(victim, old, old)

      // Another account planted the per-user directory as a symlink before the first Run.
      await fs.symlink(victim, path.dirname(root))
      await expect(
        sweepSessionScratchDirectories([], root, Date.now() + EIGHT_DAYS_MS),
      ).resolves.toBe(0)
      expect((await fs.stat(project)).isDirectory()).toBe(true)

      // A symlinked namespace next to the Host's own one is left alone too.
      await fs.rm(path.dirname(root))
      await prepareSessionScratchDirectory('session-own', root)
      await fs.symlink(victim, path.join(path.dirname(root), 'planted'))
      await sweepSessionScratchDirectories(['session-own'], root, Date.now() + EIGHT_DAYS_MS)
      expect((await fs.stat(project)).isDirectory()).toBe(true)
    },
  )

  it('keeps sweeping after one directory cannot be removed', async () => {
    const [stuck, stale] = await Promise.all([
      prepareSessionScratchDirectory('session-stuck', root),
      prepareSessionScratchDirectory('session-stale', root),
    ])
    const rm = fs.rm.bind(fs)
    const spy = vi.spyOn(fs, 'rm').mockImplementation(async (target, options) => {
      if (target === stuck) throw Object.assign(new Error('denied'), { code: 'EACCES' })
      return rm(target, options)
    })
    try {
      await expect(
        sweepSessionScratchDirectories([], root, Date.now() + TWO_HOURS_MS),
      ).resolves.toBe(1)
    } finally {
      spy.mockRestore()
    }
    await expect(fs.access(stale)).rejects.toMatchObject(missing)
  })

  it('treats a missing scratch root as nothing to sweep', async () => {
    await expect(sweepSessionScratchDirectories([], root)).resolves.toBe(0)
  })
})
