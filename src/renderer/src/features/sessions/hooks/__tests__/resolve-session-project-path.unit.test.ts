import { describe, expect, it } from 'vitest'
import { resolveSessionProjectPath } from '../useSessionProjectPath'

const base = {
  activeSessionId: null,
  activeSessionProjectPath: null,
  activeSummaryProjectPath: null,
  preferredProjectPath: '/projects/a',
}

describe('resolveSessionProjectPath', () => {
  it("uses the open Session's project over the preference", () => {
    expect(
      resolveSessionProjectPath({
        ...base,
        activeSessionId: 's-b',
        activeSessionProjectPath: '/projects/b',
        activeSummaryProjectPath: '/projects/b',
      }),
    ).toBe('/projects/b')
  })

  it("uses the Session's catalog summary while its detail is still loading", () => {
    expect(
      resolveSessionProjectPath({
        ...base,
        activeSessionId: 's-b',
        activeSummaryProjectPath: '/projects/b',
      }),
    ).toBe('/projects/b')
  })

  it('names no project, never the previous one, while the selected Session is unknown', () => {
    expect(resolveSessionProjectPath({ ...base, activeSessionId: 's-b' })).toBeNull()
  })

  it('uses the preference without a Session, as a draft composer does', () => {
    expect(resolveSessionProjectPath(base)).toBe('/projects/a')
    expect(resolveSessionProjectPath({ ...base, preferredProjectPath: null })).toBeNull()
  })
})
