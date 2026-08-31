import { SessionId } from '@shared/types/brand'
import { describe, expect, it } from 'vitest'
import { resolveReportTargets } from '../report-target-resolution'

describe('Session Control report target resolution', () => {
  it('resolves upstream to the immediate parent recorded in Spawn lineage', () => {
    const parentSessionId = SessionId('session-parent')

    const result = resolveReportTargets({
      selector: { type: 'upstream' },
      source: {
        sessionId: SessionId('session-worker'),
        parentSessionId,
        queenSessionId: SessionId('session-queen'),
      },
      authorizedCandidates: [],
    })

    expect(result).toEqual({ resolved: true, targetSessionIds: [parentSessionId] })
  })

  it('returns authorized candidates instead of guessing an ambiguous Worker reference', () => {
    const firstWorkerId = SessionId('session-worker-first')
    const secondWorkerId = SessionId('session-worker-second')

    const result = resolveReportTargets({
      selector: { type: 'worker-reference', reference: 'reviewer' },
      source: {
        sessionId: SessionId('session-queen'),
        parentSessionId: null,
        queenSessionId: SessionId('session-queen'),
      },
      authorizedCandidates: [
        { sessionId: firstWorkerId, referenceNames: ['Reviewer'] },
        { sessionId: secondWorkerId, referenceNames: ['reviewer'] },
      ],
    })

    expect(result).toEqual({
      resolved: false,
      code: 'target_ambiguous',
      candidates: [firstWorkerId, secondWorkerId],
    })
  })
})
