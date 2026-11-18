import { describe, expect, it } from 'vitest'
import { rootSessionReachesEveryProject } from '../root-session-project-reach'

const root = { isRoot: true } as const

describe('rootSessionReachesEveryProject', () => {
  it.each(['gui:local-user', 'local-user', 'local-user:d7cde2b6'])(
    'lets a root from the local user %s reach every project',
    (originCallerId) => {
      expect(rootSessionReachesEveryProject({ ...root, originCallerId })).toBe(true)
      expect(
        rootSessionReachesEveryProject({ ...root, originCallerId, snapshotScope: { all: true } }),
      ).toBe(true)
    },
  )

  it('keeps a local-user root inside its project when its snapshot is narrower', () => {
    expect(
      rootSessionReachesEveryProject({
        ...root,
        originCallerId: 'gui:local-user',
        snapshotScope: {},
      }),
    ).toBe(false)
  })

  it('needs a live catalog-wide scope for a root from a CLI profile', () => {
    const originCallerId = 'profile:ci'
    expect(
      rootSessionReachesEveryProject({ ...root, originCallerId, liveProfileScope: { all: true } }),
    ).toBe(true)
    expect(rootSessionReachesEveryProject({ ...root, originCallerId, liveProfileScope: {} })).toBe(
      false,
    )
    expect(rootSessionReachesEveryProject({ ...root, originCallerId })).toBe(false)
  })

  it.each(['transient-mcp:workspace', 'session-agent:s:r', 'unknown'])(
    'never treats the origin %s as the desktop user, even with no scope data',
    (originCallerId) => {
      expect(rootSessionReachesEveryProject({ ...root, originCallerId })).toBe(false)
    },
  )

  it('never lets a Worker reach every project', () => {
    expect(
      rootSessionReachesEveryProject({
        isRoot: false,
        originCallerId: 'gui:local-user',
        snapshotScope: { all: true },
      }),
    ).toBe(false)
  })
})
