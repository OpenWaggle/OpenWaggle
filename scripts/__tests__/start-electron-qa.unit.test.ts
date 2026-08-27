import fs from 'node:fs/promises'
import { once } from 'node:events'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { spawn } from 'node:child_process'
import {
  observeElectronQaChildExit,
  windowsTaskkillArguments,
} from '../electron-qa-process'
import {
  captureRequiredQaEvidence,
  completeElectronQaShutdown,
} from '../electron-qa-shutdown'
import {
  assertQaPortAvailable,
  isOwnedQaTemporaryPath,
  parseQaLeaseMetadata,
  QA_CDP_PORT,
  qaPageMatchesAutomationIdentity,
  recoverStaleQaLease,
} from '../start-electron-qa'

describe('managed Electron QA launcher', () => {
  it('validates lease metadata before trusting cleanup paths', () => {
    const profilePath = path.join(os.tmpdir(), 'openwaggle-qa-profile-safe')
    const artifactsPath = path.join(os.tmpdir(), 'openwaggle-qa-evidence-safe')

    expect(
      parseQaLeaseMetadata({
        version: 1,
        launcherPid: 123,
        port: QA_CDP_PORT,
        profilePath,
        artifactsPath,
        projectPath: '/project',
      }),
    ).toMatchObject({ launcherPid: 123, profilePath })
    expect(parseQaLeaseMetadata({ launcherPid: '123', profilePath })).toBeNull()
    expect(isOwnedQaTemporaryPath(profilePath, 'openwaggle-qa-profile-')).toBe(true)
    expect(isOwnedQaTemporaryPath('/project', 'openwaggle-qa-profile-')).toBe(false)
  })

  it('accepts only the renderer page carrying the current launcher identity', () => {
    expect(
      qaPageMatchesAutomationIdentity(
        'http://localhost:5173/?openwaggle-automation-id=current',
        'current',
      ),
    ).toBe(true)
    expect(
      qaPageMatchesAutomationIdentity(
        'http://localhost:5173/?openwaggle-automation-id=other',
        'current',
      ),
    ).toBe(false)
  })

  it('fails when a requested QA port is already occupied', async () => {
    const server = net.createServer()
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen({ host: '127.0.0.1', port: 0 }, resolve)
    })
    const address = server.address()
    if (address === null || typeof address === 'string') {
      server.close()
      throw new Error('Expected a TCP address.')
    }

    await expect(assertQaPortAvailable(address.port)).rejects.toThrow('already occupied')
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()))
    })
  })

  it('recovers a validated stale lease without touching its retained evidence', async () => {
    const profilePath = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-qa-profile-'))
    const artifactsPath = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-qa-evidence-'))
    const leasePath = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-qa-test-lease-'))
    await fs.writeFile(
      path.join(leasePath, 'metadata.json'),
      JSON.stringify({
        version: 1,
        launcherPid: 2_147_483_647,
        port: QA_CDP_PORT,
        profilePath,
        artifactsPath,
        projectPath: '/project',
      }),
    )

    try {
      await Promise.all([recoverStaleQaLease(leasePath), recoverStaleQaLease(leasePath)])
      await expect(fs.stat(profilePath)).rejects.toThrow()
      await expect(fs.stat(leasePath)).rejects.toThrow()
      await expect(fs.stat(artifactsPath)).resolves.toBeDefined()
    } finally {
      await fs.rm(profilePath, { force: true, recursive: true })
      await fs.rm(leasePath, { force: true, recursive: true })
      await fs.rm(artifactsPath, { force: true, recursive: true })
    }
  })

  it('always stops Electron when required screenshot capture fails', async () => {
    const closeConnection = vi.fn(() => Promise.resolve())
    const stopChild = vi.fn(() => Promise.resolve())

    await expect(
      completeElectronQaShutdown({
        captureEvidence: () => Promise.reject(new Error('screenshot failed')),
        closeConnection,
        stopChild,
      }),
    ).rejects.toThrow('screenshot failed')
    expect(closeConnection).toHaveBeenCalledOnce()
    expect(stopChild).toHaveBeenCalledOnce()
  })

  it('reports a closed page as missing required evidence', async () => {
    await expect(
      captureRequiredQaEvidence(
        {
          isClosed: () => true,
          screenshot: vi.fn(() => Promise.resolve()),
        },
        '/tmp/qa-final.png',
      ),
    ).rejects.toThrow('required final screenshot')
  })

  it('uses Windows taskkill tree and force flags', () => {
    expect(windowsTaskkillArguments(123)).toEqual(['/pid', '123', '/t', '/f'])
  })

  it('observes a child that already exited before the listener was attached', async () => {
    const child = spawn(process.execPath, ['-e', 'process.exit(7)'])
    await once(child, 'exit')

    await expect(observeElectronQaChildExit(child)).resolves.toBe(7)
  })

  it('observes asynchronous spawn errors immediately', async () => {
    const child = spawn('/openwaggle/command-that-does-not-exist')

    await expect(observeElectronQaChildExit(child)).rejects.toBeDefined()
  })
})
