import { SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { describe, expect, it } from 'vitest'
import { acquireSessionRemovalAdmission, reserveSessionTreeMutation } from '../active-session-runs'
import {
  refuseRestoreWhileRemovalFenced,
  SESSION_RESTORE_FENCED_MESSAGE,
} from '../session-restore-fence'

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

  it('refuses a restore while the session is being archived or deleted', async () => {
    const sessionId = SessionId('removal-admission-restore')
    const admission = acquireSessionRemovalAdmission(sessionId)
    try {
      await expect(Effect.runPromise(refuseRestoreWhileRemovalFenced(sessionId))).rejects.toThrow(
        SESSION_RESTORE_FENCED_MESSAGE,
      )
    } finally {
      admission.release()
    }
    await expect(Effect.runPromise(refuseRestoreWhileRemovalFenced(sessionId))).resolves.toBe(
      undefined,
    )
  })
})
