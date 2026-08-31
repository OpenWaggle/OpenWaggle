import { RunId, SessionId } from '@shared/types/brand'
import { describe, expect, it } from 'vitest'
import { startClaimedReplacement } from '../run-replacement'

describe('Session Control Run replacement', () => {
  it('starts a replacement only from the claimed exact stopping Run', () => {
    const result = startClaimedReplacement(
      {
        sessionId: SessionId('session-target'),
        revision: 4,
        run: { state: 'stopping', runId: RunId('run-old') },
        followUpQueue: { state: 'running', revision: 0, items: [] },
      },
      RunId('run-old'),
      RunId('run-new'),
      {
        text: 'Use a replacement approach.',
        attachmentIds: [],
        callerId: 'local-user',
        acceptedAt: 1000,
        idempotencyKey: 'replace',
      },
    )

    expect(result).toMatchObject({
      revision: 5,
      run: {
        state: 'starting',
        runId: RunId('run-new'),
        intent: { text: 'Use a replacement approach.' },
      },
    })
  })
})
