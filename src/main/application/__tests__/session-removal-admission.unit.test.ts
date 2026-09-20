import { SessionId } from '@shared/types/brand'
import { describe, expect, it } from 'vitest'
import { acquireSessionRemovalAdmission, reserveSessionTreeMutation } from '../active-session-runs'

describe('exact Session removal admission', () => {
  it('allows only the current removal holder to reserve its tree writer', () => {
    const sessionId = SessionId('removal-admission-exact')
    const first = acquireSessionRemovalAdmission(sessionId)
    try {
      expect(() => reserveSessionTreeMutation(sessionId)).toThrow()
      const writer = first.reserveTreeMutation()
      writer.release()
    } finally {
      first.release()
    }

    const next = acquireSessionRemovalAdmission(sessionId)
    try {
      first.release()
      expect(() => first.reserveTreeMutation()).toThrow()
      expect(() => reserveSessionTreeMutation(sessionId)).toThrow()
      const writer = next.reserveTreeMutation()
      writer.release()
    } finally {
      next.release()
    }
    const writer = reserveSessionTreeMutation(sessionId)
    writer.release()
  })
})
