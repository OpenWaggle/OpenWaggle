import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { isOwnedQaTemporaryPath, qaSharedTemporaryDirectory } from '../electron-qa-lease'

describe('Electron QA lease location', () => {
  it('keeps the port lease in the Host temp directory shared by every Session', () => {
    // An agent shell's TMPDIR is its own Session scratch directory; a lease there would let two
    // Sessions both believe they hold the QA port.
    expect(
      qaSharedTemporaryDirectory({
        TMPDIR: '/tmp/ow-scratch-501/37a8eec1/0123456789ab',
        OPENWAGGLE_HOST_TMPDIR: '/var/folders/host/T',
      }),
    ).toBe('/var/folders/host/T')
  })

  it('uses the ordinary temp directory outside an agent shell', () => {
    expect(qaSharedTemporaryDirectory({})).toBe(os.tmpdir())
  })

  it('recognizes a profile another Session created in the shared directory as recoverable', () => {
    const shared = '/var/folders/host/T'
    // Created by a launcher whose own TMPDIR was a different Session's scratch directory.
    expect(
      isOwnedQaTemporaryPath(`${shared}/openwaggle-qa-profile-abc`, 'openwaggle-qa-profile-', shared),
    ).toBe(true)
    expect(
      isOwnedQaTemporaryPath(
        '/tmp/ow-scratch-501/37a8eec1/0123456789ab/openwaggle-qa-profile-abc',
        'openwaggle-qa-profile-',
        shared,
      ),
    ).toBe(false)
  })

  describe('when launched from an agent shell', () => {
    const roots: string[] = []

    afterEach(async () => {
      vi.unstubAllEnvs()
      vi.resetModules()
      await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
    })

    it('puts the lease, profile, and evidence in the Host temp directory, not TMPDIR', async () => {
      const [host, scratch] = await Promise.all([
        fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-qa-host-')),
        fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-qa-scratch-')),
      ])
      roots.push(host, scratch)
      vi.stubEnv('OPENWAGGLE_HOST_TMPDIR', host)
      vi.stubEnv('TMPDIR', scratch)
      // A port nothing else uses, so the test never meets a real QA lease.
      vi.stubEnv('OPENWAGGLE_QA_CDP_PORT', String(40_000 + (process.pid % 20_000)))
      vi.resetModules()
      const { acquireQaLease, releaseQaLease } = await import('../electron-qa-lease')

      const lease = await acquireQaLease('/project')
      try {
        expect(path.dirname(lease.directory)).toBe(host)
        expect(path.dirname(lease.metadata.profilePath)).toBe(host)
        expect(path.dirname(lease.metadata.artifactsPath)).toBe(host)
        expect(await fs.readdir(scratch)).toEqual([])
      } finally {
        await releaseQaLease(lease)
      }
    })
  })
})
