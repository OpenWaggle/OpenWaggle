import { describe, expect, it } from 'vitest'
import { resolveSessionProjectPath } from '../useSessionProjectPath'

const base = {
  activeSessionId: null,
  activeSessionProjectPath: null,
  draftProjectPath: null,
  hasDraft: false,
  preferredProjectPath: '/projects/a',
}

describe('resolveSessionProjectPath', () => {
  it("uses the open Session's project over the preference", () => {
    expect(
      resolveSessionProjectPath({
        ...base,
        activeSessionId: 's-b',
        activeSessionProjectPath: '/projects/b',
      }),
    ).toBe('/projects/b')
  })

  it('names no project while the selected Session is still loading', () => {
    expect(resolveSessionProjectPath({ ...base, activeSessionId: 's-b' })).toBeNull()
  })

  it("uses a draft Session's project, and the preference only for a draft without one", () => {
    expect(
      resolveSessionProjectPath({ ...base, hasDraft: true, draftProjectPath: '/projects/b' }),
    ).toBe('/projects/b')
    expect(resolveSessionProjectPath({ ...base, hasDraft: true })).toBe('/projects/a')
  })

  it('falls back to the preference with no Session or draft', () => {
    expect(resolveSessionProjectPath(base)).toBe('/projects/a')
    expect(resolveSessionProjectPath({ ...base, preferredProjectPath: null })).toBeNull()
  })
})
