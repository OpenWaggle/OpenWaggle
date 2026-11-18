import { SESSION_TITLE_MAX_LENGTH, SESSION_TITLE_MIN_LENGTH } from '@shared/session-title'
import { Check } from 'typebox/value'
import { describe, expect, it } from 'vitest'
import { sessionsToolParameters } from '../sessions-tool-parameters'

describe('Pi-native Sessions title contract', () => {
  it.each([
    { action: 'create', projectPath: '/project' },
    { action: 'launch', projectPath: '/project', objective: 'Implement the change.' },
    { action: 'fork', sessionId: 'session-source' },
    { action: 'rename', sessionId: 'session-target' },
  ])('enforces one shared non-blank title bound for $action', (input) => {
    expect(
      Check(sessionsToolParameters, { ...input, title: 'x'.repeat(SESSION_TITLE_MIN_LENGTH) }),
    ).toBe(true)
    expect(
      Check(sessionsToolParameters, { ...input, title: 'x'.repeat(SESSION_TITLE_MAX_LENGTH) }),
    ).toBe(true)
    expect(Check(sessionsToolParameters, { ...input, title: '' })).toBe(false)
    expect(Check(sessionsToolParameters, { ...input, title: '   ' })).toBe(false)
    expect(
      Check(sessionsToolParameters, {
        ...input,
        title: 'x'.repeat(SESSION_TITLE_MAX_LENGTH + 1),
      }),
    ).toBe(false)
  })
})
