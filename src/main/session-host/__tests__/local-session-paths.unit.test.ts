import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { prepareLocalSessionHostPaths, resolveLocalSessionHostPaths } from '../local-session-paths'

const OWNER_DIRECTORY_MODE = 0o700

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

  it('scopes stable Windows named pipes by the configured user-data root', () => {
    const first = resolveLocalSessionHostPaths({
      userDataRoot: 'C:\\Users\\one',
      platform: 'win32',
    })
    const second = resolveLocalSessionHostPaths({
      userDataRoot: 'C:\\Users\\two',
      platform: 'win32',
    })

    expect(first.endpoint).toMatch(/^\\\\\.\\pipe\\openwaggle-[a-f0-9]{20}-session-host$/)
    expect(second.endpoint).not.toBe(first.endpoint)
  })
})
