import fs from 'node:fs/promises'
import { once } from 'node:events'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { qaSharedTemporaryDirectory } from '../electron-qa-lease'
import { spawn } from 'node:child_process'
import {
  observeElectronQaChildExit,
  windowsTaskkillArguments,
} from '../electron-qa-process'
import {
  captureRequiredQaEvidence,
  completeElectronQaShutdown,
  stopElectronQaSessionHost,
} from '../electron-qa-shutdown'
import {
  assertQaPortAvailable,
  electronEnvironment,
  electronQaLaunchArguments,
  isOwnedQaTemporaryPath,
  parseQaLeaseMetadata,
  prepareQaHome,
  QA_CDP_PORT,
  qaPageMatchesAutomationIdentity,
  recoverStaleQaLease,
} from '../start-electron-qa'

const lease = {
  automationIdentity: 'identity',
  directory: '/tmp/lease',
  metadata: {
    version: 1 as const,
    launcherPid: 1,
    port: QA_CDP_PORT,
    profilePath: '/tmp/profile',
    artifactsPath: '/tmp/evidence',
    projectPath: '/project',
  },
}

describe('managed Electron QA launcher', () => {
  it('keeps first-party Pi extension tools only when the caller asks for them', () => {

    expect(electronEnvironment(lease, {})).not.toHaveProperty(
      'OPENWAGGLE_AUTOMATION_FIRST_PARTY_EXTENSIONS',
    )
    expect(
      electronEnvironment(lease, { OPENWAGGLE_AUTOMATION_FIRST_PARTY_EXTENSIONS: '1' }),
    ).toMatchObject({ OPENWAGGLE_AUTOMATION: '1', OPENWAGGLE_AUTOMATION_FIRST_PARTY_EXTENSIONS: '1' })
    expect(electronEnvironment(lease, {})).not.toHaveProperty('OPENWAGGLE_AUTOMATION_PI_EXTENSIONS')
    expect(
      electronEnvironment(lease, { OPENWAGGLE_AUTOMATION_PI_EXTENSIONS: '/tmp/qa/router.js' }),
    ).toMatchObject({ OPENWAGGLE_AUTOMATION_PI_EXTENSIONS: '/tmp/qa/router.js' })
  })

  it('gives the app a home, Pi agent directory, and user data inside the QA profile', () => {
    const previous = { HOME: process.env.HOME, PI: process.env.PI_CODING_AGENT_DIR }
    process.env.HOME = '/Users/maintainer'
    process.env.PI_CODING_AGENT_DIR = '/Users/maintainer/.pi/agent'
    try {
      expect(electronEnvironment(lease, {})).toMatchObject({
        HOME: path.join('/tmp/profile', 'qa-home'),
        USERPROFILE: path.join('/tmp/profile', 'qa-home'),
        PI_CODING_AGENT_DIR: path.join('/tmp/profile', 'qa-home', '.pi', 'agent'),
        OPENWAGGLE_USER_DATA_DIR: '/tmp/profile',
      })
    } finally {
      process.env.HOME = previous.HOME
      if (previous.PI === undefined) delete process.env.PI_CODING_AGENT_DIR
      else process.env.PI_CODING_AGENT_DIR = previous.PI
    }
  })

  it('creates the QA home, and releases the lease when it cannot', async () => {
    const makeDirectory = vi.fn(() => Promise.resolve())
    const release = vi.fn(() => Promise.resolve())
    await prepareQaHome(lease, { makeDirectory, release })
    expect(makeDirectory).toHaveBeenCalledWith(path.join('/tmp/profile', 'qa-home', '.pi', 'agent'))
    expect(release).not.toHaveBeenCalled()

    const failure = new Error('ENOSPC')
    await expect(
      prepareQaHome(lease, { makeDirectory: () => Promise.reject(failure), release }),
    ).rejects.toBe(failure)
    expect(release).toHaveBeenCalledWith(lease)
  })

  it('connects project MCP servers only when the caller asks for them', () => {
    expect(electronEnvironment(lease, {})).not.toHaveProperty('OPENWAGGLE_AUTOMATION_PROJECT_MCP')
    expect(
      electronEnvironment(lease, { OPENWAGGLE_AUTOMATION_PROJECT_MCP: '1' }),
    ).toMatchObject({ OPENWAGGLE_AUTOMATION_PROJECT_MCP: '1' })
  })

  it.each([
    ['darwin', ['--use-mock-keychain']],
    ['win32', ['--use-mock-keychain']],
    ['linux', ['--use-mock-keychain', '--password-store=basic']],
  ] satisfies [NodeJS.Platform, string[]][])(
    'starts Electron on %s with the mock credential store and the QA CDP port',
    (platform, credentialSwitches) => {
      expect(electronQaLaunchArguments(platform)).toEqual([
        'exec',
        'electron-vite',
        'dev',
        '--',
        ...credentialSwitches,
        `--remote-debugging-port=${QA_CDP_PORT}`,
      ])
    },
  )

  it('validates lease metadata before trusting cleanup paths', () => {
    // Launchers create these in the shared directory, which differs from TMPDIR in agent shells.
    const profilePath = path.join(qaSharedTemporaryDirectory(), 'openwaggle-qa-profile-safe')
    const artifactsPath = path.join(qaSharedTemporaryDirectory(), 'openwaggle-qa-evidence-safe')

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
    const profilePath = await fs.mkdtemp(
      path.join(qaSharedTemporaryDirectory(), 'openwaggle-qa-profile-'),
    )
    const artifactsPath = await fs.mkdtemp(
      path.join(qaSharedTemporaryDirectory(), 'openwaggle-qa-evidence-'),
    )
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

  it('always stops Electron and its Session Host when required screenshot capture fails', async () => {
    const closeConnection = vi.fn(() => Promise.resolve())
    const stopChild = vi.fn(() => Promise.resolve())
    const stopSessionHost = vi.fn(() => Promise.resolve())

    await expect(
      completeElectronQaShutdown({
        captureEvidence: () => Promise.reject(new Error('screenshot failed')),
        closeConnection,
        stopChild,
        stopSessionHost,
      }),
    ).rejects.toThrow('screenshot failed')
    expect(closeConnection).toHaveBeenCalledOnce()
    expect(stopChild).toHaveBeenCalledOnce()
    expect(stopSessionHost).toHaveBeenCalledOnce()
  })

  it('stops the detached Session Host only after the Electron process group', async () => {
    const order: string[] = []
    const step = (name: string) => async () => {
      order.push(name)
    }

    await completeElectronQaShutdown({
      captureEvidence: step('evidence'),
      closeConnection: step('connection'),
      stopChild: async () => {
        order.push('electron')
        throw new Error('Electron process group did not exit')
      },
      stopSessionHost: step('session-host'),
    }).catch(() => undefined)

    expect(order).toEqual(['evidence', 'connection', 'electron', 'session-host'])
  })

  it('drains the QA profile Session Host and clears the profile while it holds ownership', async () => {
    const ownership = { targetPath: '/tmp/profile/session-host/session-host.sqlite', release: vi.fn() }
    const finalize = vi.fn(() => Promise.resolve())
    const prepareProfileRemoval = vi.fn(() => Promise.resolve(finalize))
    const shutdownHost = vi.fn(
      async (_profile: string, whileOwnershipHeld: (held: typeof ownership) => Promise<unknown>) => {
        await whileOwnershipHeld(ownership)
      },
    )

    await stopElectronQaSessionHost('/tmp/profile', { shutdownHost, prepareProfileRemoval })

    expect(shutdownHost).toHaveBeenCalledWith('/tmp/profile', expect.any(Function))
    expect(prepareProfileRemoval).toHaveBeenCalledWith('/tmp/profile', ownership)
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
