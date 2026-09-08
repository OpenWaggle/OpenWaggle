import type { RemoteVcsStatusResult } from '@shared/types/git'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const getLocalVcsStatus = vi.hoisted(() => vi.fn())
const getRemoteVcsStatus = vi.hoisted(() => vi.fn())

vi.mock('../vcs-status-service', () => ({ getLocalVcsStatus, getRemoteVcsStatus }))

const { invalidateVcsStatus, readRemoteVcsStatus } = await import('../vcs-status-cache')

const REMOTE_RESULT = {
  ok: true,
  status: {
    hasUpstream: true,
    aheadCount: 1,
    behindCount: 0,
    aheadOfDefaultCount: 1,
    changeRequest: null,
  },
} as const satisfies RemoteVcsStatusResult

describe('VCS status cache single-flight behavior', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-05T10:00:00.000Z'))
    invalidateVcsStatus()
    getLocalVcsStatus.mockReset()
    getRemoteVcsStatus.mockReset()
  })

  afterEach(() => {
    invalidateVcsStatus()
    vi.useRealTimers()
  })

  it('joins a slow remote lookup even after the result TTL would have elapsed', async () => {
    let resolveLookup: ((result: RemoteVcsStatusResult) => void) | undefined
    const pending = new Promise<RemoteVcsStatusResult>((resolve) => {
      resolveLookup = resolve
    })
    getRemoteVcsStatus.mockReturnValue(pending)

    const first = readRemoteVcsStatus('/repo')
    vi.setSystemTime(new Date('2026-09-05T10:01:00.000Z'))
    const second = readRemoteVcsStatus('/repo')

    resolveLookup?.(REMOTE_RESULT)
    await expect(Promise.all([first, second])).resolves.toEqual([REMOTE_RESULT, REMOTE_RESULT])
    expect(getRemoteVcsStatus).toHaveBeenCalledOnce()
  })

  it('starts the successful-result TTL when a slow lookup settles', async () => {
    let resolveLookup: ((result: RemoteVcsStatusResult) => void) | undefined
    const pending = new Promise<RemoteVcsStatusResult>((resolve) => {
      resolveLookup = resolve
    })
    getRemoteVcsStatus.mockReturnValueOnce(pending).mockResolvedValue(REMOTE_RESULT)

    const first = readRemoteVcsStatus('/repo')
    vi.setSystemTime(new Date('2026-09-05T10:01:00.000Z'))
    resolveLookup?.(REMOTE_RESULT)
    await first
    await Promise.resolve()

    vi.setSystemTime(new Date('2026-09-05T10:01:10.000Z'))
    await expect(readRemoteVcsStatus('/repo')).resolves.toEqual(REMOTE_RESULT)
    expect(getRemoteVcsStatus).toHaveBeenCalledOnce()

    vi.setSystemTime(new Date('2026-09-05T10:01:16.000Z'))
    await expect(readRemoteVcsStatus('/repo')).resolves.toEqual(REMOTE_RESULT)
    expect(getRemoteVcsStatus).toHaveBeenCalledTimes(2)
  })
})
