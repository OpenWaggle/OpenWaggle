import { SessionId } from '@shared/types/brand'
import type { SessionDetail } from '@shared/types/session'
import { describe, expect, it } from 'vitest'
import { resolveSessionProjectPath } from '../session-manager'

function session(projectPath: string | null) {
  return {
    id: SessionId('session-1'),
    title: 'Session',
    projectPath,
    messages: [],
    createdAt: 1,
    updatedAt: 1,
  } satisfies SessionDetail
}

describe('Pi session manager helpers', () => {
  it('requires a concrete project path before creating Pi sessions', () => {
    expect(resolveSessionProjectPath(session('/repo'))).toBe('/repo')
    expect(() => resolveSessionProjectPath(session(null))).toThrow(
      'No project path set on the session - cannot run Pi agent',
    )
  })
})
