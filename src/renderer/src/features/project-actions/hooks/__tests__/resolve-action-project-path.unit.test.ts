import { describe, expect, it } from 'vitest'
import { resolveActionProjectPath } from '../useActionProjectPath'

const base = {
  activeSessionId: null,
  activeSession: null,
  draftSession: null,
  preferredProjectPath: '/projects/a',
}

describe('resolveActionProjectPath', () => {
  it("uses the open Session's project over the preference", () => {
    expect(
      resolveActionProjectPath({
        ...base,
        activeSessionId: 's-b',
        activeSession: { id: 's-b', projectPath: '/projects/b' },
      }),
    ).toBe('/projects/b')
  })

  it('names no project while the selected Session is still loading', () => {
    expect(resolveActionProjectPath({ ...base, activeSessionId: 's-b' })).toBeNull()
    expect(
      resolveActionProjectPath({
        ...base,
        activeSessionId: 's-b',
        activeSession: { id: 's-a', projectPath: '/projects/a' },
      }),
    ).toBeNull()
  })

  it("uses a draft Session's project, and the preference only for a draft without one", () => {
    expect(
      resolveActionProjectPath({ ...base, draftSession: { projectPath: '/projects/b' } }),
    ).toBe('/projects/b')
    expect(resolveActionProjectPath({ ...base, draftSession: { projectPath: null } })).toBe(
      '/projects/a',
    )
  })

  it('falls back to the preference with no Session or draft', () => {
    expect(resolveActionProjectPath(base)).toBe('/projects/a')
    expect(resolveActionProjectPath({ ...base, preferredProjectPath: null })).toBeNull()
  })
})
