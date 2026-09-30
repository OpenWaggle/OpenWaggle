import { describe, expect, it } from 'vitest'
import { rootSessionReachesEveryProject } from '../root-session-project-reach'

describe('rootSessionReachesEveryProject', () => {
  it('lets a root with no narrowing scope, or only catalog-wide ones, reach every project', () => {
    expect(rootSessionReachesEveryProject({ isRoot: true, originScopes: [] })).toBe(true)
    expect(
      rootSessionReachesEveryProject({
        isRoot: true,
        originScopes: [{ all: true }, { all: true }],
      }),
    ).toBe(true)
  })

  it('keeps a root inside its project when any scope is narrower', () => {
    expect(
      rootSessionReachesEveryProject({ isRoot: true, originScopes: [{ all: true }, {}] }),
    ).toBe(false)
  })

  it('never lets a Worker reach every project', () => {
    expect(rootSessionReachesEveryProject({ isRoot: false, originScopes: [] })).toBe(false)
    expect(rootSessionReachesEveryProject({ isRoot: false, originScopes: [{ all: true }] })).toBe(
      false,
    )
  })
})
