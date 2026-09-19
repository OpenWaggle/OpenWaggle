import { tmpdir } from 'node:os'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { withProcessFileLock } from '../process-file-lock'

const { lockMock, releaseMock } = vi.hoisted(() => ({
  lockMock: vi.fn(),
  releaseMock: vi.fn(async () => undefined),
}))

vi.mock('proper-lockfile', () => ({
  default: { lock: lockMock },
}))

beforeEach(() => {
  lockMock.mockReset()
  releaseMock.mockClear()
})

describe('withProcessFileLock wait policy', () => {
  it('waits through contention and runs after the lock becomes available', async () => {
    lockMock
      .mockRejectedValueOnce(Object.assign(new Error('busy'), { code: 'ELOCKED' }))
      .mockResolvedValueOnce(releaseMock)
    const operation = vi.fn(async () => 'completed')

    await expect(
      withProcessFileLock(path.join(tmpdir(), 'openwaggle-lock-contention'), operation, {
        waitUntilAvailable: true,
      }),
    ).resolves.toBe('completed')

    expect(lockMock).toHaveBeenCalledTimes(2)
    expect(operation).toHaveBeenCalledOnce()
    expect(releaseMock).toHaveBeenCalledOnce()
  })

  it('propagates permanent lock acquisition errors without retrying', async () => {
    const permanent = Object.assign(new Error('read-only filesystem'), { code: 'EROFS' })
    lockMock.mockRejectedValue(permanent)

    await expect(
      withProcessFileLock(
        path.join(tmpdir(), 'openwaggle-lock-permanent-error'),
        async () => undefined,
        { waitUntilAvailable: true },
      ),
    ).rejects.toBe(permanent)

    expect(lockMock).toHaveBeenCalledOnce()
  })
})
