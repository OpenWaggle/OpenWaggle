import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  prepareLocalSessionHostPaths,
  refreshLocalSessionHostEndpoint,
  renameThroughTransientLocks,
  resolveLocalSessionHostPaths,
  rotateLocalSessionHostEndpoint,
} from '../local-session-paths'

const OWNER_DIRECTORY_MODE = 0o700

const envMocks = vi.hoisted(() => {
  const state: { hostTemporaryDirectory?: string } = {}
  return state
})
vi.mock('../../env', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../env')>()
  return {
    ...original,
    env: new Proxy(original.env, {
      get: (target, key) =>
        key === 'OPENWAGGLE_HOST_TMPDIR'
          ? envMocks.hostTemporaryDirectory
          : Reflect.get(target, key),
    }),
  }
})

function longUserDataRoot(root: string) {
  let candidate = path.join(root, 'user-data')
  let index = 0
  while (Buffer.byteLength(path.join(candidate, 'session-host', 'host.sock'), 'utf8') <= 100) {
    candidate = path.join(candidate, `nested-${String(index).padStart(2, '0')}`)
    index += 1
  }
  return candidate
}

describe('Local Session Host paths', () => {
  const temporaryRoots: string[] = []

  afterEach(async () => {
    vi.restoreAllMocks()
    await Promise.all(
      temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })),
    )
  })

  it('keeps ordinary Unix endpoints under the configured user-data root', () => {
    const paths = resolveLocalSessionHostPaths({
      userDataRoot: '/users/test/OpenWaggle',
      platform: 'darwin',
      temporaryRoot: '/tmp',
    })

    expect(paths).toMatchObject({
      stateRoot: '/users/test/OpenWaggle/session-host',
      databasePath: '/users/test/OpenWaggle/session-host/session-host.sqlite',
      endpoint: '/users/test/OpenWaggle/session-host/host.sock',
    })
  })

  it('uses a stable short fallback when a Unix socket path would exceed platform limits', () => {
    const longRoot = path.join('/users/test', 'nested-segment'.repeat(20))
    const first = resolveLocalSessionHostPaths({
      userDataRoot: longRoot,
      platform: 'darwin',
      temporaryRoot: '/private/tmp',
    })
    const second = resolveLocalSessionHostPaths({
      userDataRoot: longRoot,
      platform: 'linux',
      temporaryRoot: '/private/tmp',
    })

    expect(first.endpoint).toBe(second.endpoint)
    expect(first.endpoint).toMatch(/^\/private\/tmp\/owsh-[a-f0-9]{20}\/host\.sock$/)
    expect(Buffer.byteLength(first.endpoint, 'utf8')).toBeLessThanOrEqual(100)
  })

  it('finds the Host socket fallback from an agent tool process with a scratch TMPDIR', () => {
    const longRoot = path.join('/users/test', 'nested-segment'.repeat(20))
    envMocks.hostTemporaryDirectory = '/var/folders/73/f8dtlm290sxdl1n1ktfgsdg40000gn/T'
    vi.spyOn(os, 'tmpdir').mockReturnValue('/tmp/ow-scratch-501/0123456789abcdef')
    try {
      const agentShell = resolveLocalSessionHostPaths({
        userDataRoot: longRoot,
        platform: 'darwin',
      })
      const host = resolveLocalSessionHostPaths({
        userDataRoot: longRoot,
        platform: 'darwin',
        temporaryRoot: envMocks.hostTemporaryDirectory,
      })

      expect(agentShell.endpoint).toBe(host.endpoint)
    } finally {
      delete envMocks.hostTemporaryDirectory
      vi.restoreAllMocks()
    }
  })

  it('falls back to /tmp when the configured temporary root is itself too long', () => {
    const paths = resolveLocalSessionHostPaths({
      userDataRoot: path.join('/users/test', 'nested-segment'.repeat(20)),
      platform: 'darwin',
      temporaryRoot: path.join('/private/tmp', 'temporary-segment'.repeat(20)),
    })

    expect(paths.endpoint).toMatch(/^\/tmp\/owsh-[a-f0-9]{20}\/host\.sock$/)
    expect(Buffer.byteLength(paths.endpoint, 'utf8')).toBeLessThanOrEqual(100)
  })

  it('prepares an owned fallback directory with owner-only permissions', async () => {
    if (process.platform === 'win32') return
    const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-session-paths-'))
    temporaryRoots.push(temporaryRoot)
    const paths = resolveLocalSessionHostPaths({
      userDataRoot: longUserDataRoot(temporaryRoot),
      platform: process.platform,
      temporaryRoot: path.join(temporaryRoot, 'sockets'),
    })

    await prepareLocalSessionHostPaths(paths)

    expect(paths.endpointDirectory).not.toBe(paths.stateRoot)
    const stats = await fs.stat(paths.endpointDirectory ?? '')
    expect(stats.isDirectory()).toBe(true)
    expect(stats.mode & 0o777).toBe(OWNER_DIRECTORY_MODE)
    if (process.getuid) expect(stats.uid).toBe(process.getuid())
  })

  it('rejects a symlinked fallback directory without chmodding its target', async () => {
    if (process.platform === 'win32') return
    const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-session-paths-'))
    temporaryRoots.push(temporaryRoot)
    const socketRoot = path.join(temporaryRoot, 'sockets')
    const paths = resolveLocalSessionHostPaths({
      userDataRoot: longUserDataRoot(temporaryRoot),
      platform: process.platform,
      temporaryRoot: socketRoot,
    })
    const target = path.join(temporaryRoot, 'unrelated-directory')
    await fs.mkdir(socketRoot, { recursive: true })
    await fs.mkdir(target, { mode: 0o755 })
    await fs.symlink(target, paths.endpointDirectory ?? '', 'dir')

    await expect(prepareLocalSessionHostPaths(paths)).rejects.toThrow()

    expect((await fs.stat(target)).mode & 0o777).toBe(0o755)
  })

  it('rejects an endpoint directory not owned by the current user', async () => {
    if (process.platform === 'win32' || !process.getuid) return
    const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-session-paths-'))
    temporaryRoots.push(temporaryRoot)
    const paths = resolveLocalSessionHostPaths({
      userDataRoot: longUserDataRoot(temporaryRoot),
      platform: process.platform,
      temporaryRoot: path.join(temporaryRoot, 'sockets'),
    })
    const currentUserId = process.getuid()
    vi.spyOn(process, 'getuid')
      .mockReturnValueOnce(currentUserId)
      .mockReturnValue(currentUserId + 1)

    await expect(prepareLocalSessionHostPaths(paths)).rejects.toThrow(
      'Local Session endpoint directory must be owned by the current user.',
    )
  })

  it('persists an owner-private random Windows endpoint capability', async () => {
    const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-session-paths-'))
    temporaryRoots.push(temporaryRoot)
    const secureUserOnly = vi.fn(async () => ({ userSid: 'S-1-5-21-1000' }))
    const unresolved = resolveLocalSessionHostPaths({
      userDataRoot: temporaryRoot,
      platform: 'win32',
    })

    const first = await prepareLocalSessionHostPaths(unresolved, 'win32', secureUserOnly)
    const second = await prepareLocalSessionHostPaths(
      resolveLocalSessionHostPaths({ userDataRoot: temporaryRoot, platform: 'win32' }),
      'win32',
      secureUserOnly,
    )

    expect(unresolved.endpoint).toBe('')
    expect(first.endpoint).toBe(second.endpoint)
    expect(first.endpoint).toMatch(/^\\\\\.\\pipe\\openwaggle-[A-Za-z0-9_-]{43}-session-host$/)
    // The first launch creates the capability; a later one secures it with the directory, in one run.
    expect(secureUserOnly.mock.calls).toEqual([
      [[{ kind: 'directory', path: first.stateRoot }]],
      [[{ kind: 'file', path: expect.stringContaining('.endpoint.capability.') }]],
      [[{ kind: 'file', path: first.endpointCapabilityPath }]],
      [
        [
          { kind: 'directory', path: first.stateRoot },
          { kind: 'file', path: first.endpointCapabilityPath },
        ],
      ],
    ])
    const capabilityPath = first.endpointCapabilityPath
    if (!capabilityPath) throw new Error('Expected a Windows endpoint capability path.')
    expect((await fs.stat(capabilityPath)).mode & 0o777).toBe(0o600)
  })

  it('rotates and atomically publishes a new Windows endpoint for each Host launch', async () => {
    const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-session-paths-'))
    temporaryRoots.push(temporaryRoot)
    const secureUserOnly = vi.fn(async () => ({ userSid: 'S-1-5-21-1000' }))
    const prepared = await prepareLocalSessionHostPaths(
      resolveLocalSessionHostPaths({ userDataRoot: temporaryRoot, platform: 'win32' }),
      'win32',
      secureUserOnly,
    )

    const rotated = await rotateLocalSessionHostEndpoint(prepared, 'win32', secureUserOnly)
    const refreshed = await refreshLocalSessionHostEndpoint(prepared, 'win32')

    expect(rotated.endpoint).not.toBe(prepared.endpoint)
    expect(refreshed.endpoint).toBe(rotated.endpoint)
    expect(secureUserOnly).toHaveBeenCalledTimes(5)
  })

  it('retries a Windows rename that a short-lived lock refuses, and gives up on other errors', async () => {
    const sleep = vi.fn(async () => undefined)
    const locked = Object.assign(new Error('EPERM: operation not permitted, rename'), {
      code: 'EPERM',
    })
    const rename = vi
      .fn<(from: string, to: string) => Promise<void>>()
      .mockRejectedValueOnce(locked)
      .mockRejectedValueOnce(Object.assign(new Error('busy'), { code: 'EBUSY' }))
      .mockResolvedValueOnce(undefined)

    await renameThroughTransientLocks('from', 'to', rename, sleep)

    expect(rename).toHaveBeenCalledTimes(3)
    expect(sleep).toHaveBeenCalledTimes(2)

    const missing = Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    const failing = vi.fn<(from: string, to: string) => Promise<void>>().mockRejectedValue(missing)
    await expect(renameThroughTransientLocks('from', 'to', failing, sleep)).rejects.toBe(missing)
    expect(failing).toHaveBeenCalledTimes(1)

    const stuck = vi.fn<(from: string, to: string) => Promise<void>>().mockRejectedValue(locked)
    await expect(renameThroughTransientLocks('from', 'to', stuck, sleep)).rejects.toBe(locked)
    expect(stuck.mock.calls.length).toBeGreaterThan(1)
  })
})
