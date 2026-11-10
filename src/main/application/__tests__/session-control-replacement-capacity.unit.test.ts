import { sessionHostRefusal } from '@shared/domain/session-host-refusals'
import { RunId, SessionId } from '@shared/types/brand'
import { SESSION_CONTROL_CONTRACT_VERSION } from '@shared/types/session-control'
import * as Effect from 'effect/Effect'
import { describe, expect, it } from 'vitest'
import {
  type ClaimSessionControlOperationInput,
  SessionControlOperationJournal,
} from '../../ports/session-control-operation-journal'
import { replaceSessionRun } from '../session-control-replacement-service'
import { makePromotionReplacementLayer } from './session-control-promotion-replacement.test-support'

/*
 * A `replace` starts a Run for its caller, so its claim carries that Run to the capacity rule
 * (ADR 0030, amended 2026-11-09). The journal refuses it at a full ceiling in the claim's own
 * transaction (`sqlite-worker-run-handover.unit.test.ts`); this pins what the service hands it.
 */
describe('Session Control Run replacement and the Worker limits', () => {
  it('claims with the replacing caller’s Run and the Active Workers ceiling', async () => {
    const claims: ClaimSessionControlOperationInput[] = []
    const setup = makePromotionReplacementLayer({
      sessionId: SessionId('session-target'),
      revision: 1,
      run: { state: 'active', runId: RunId('run-active') },
      followUpQueue: { state: 'running', revision: 0, items: [] },
    })

    const response = await Effect.runPromise(
      replaceSessionRun({
        callerId: 'transient-mcp:digest-agent',
        hostRunCeiling: 7,
        request: {
          contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
          requestId: 'request-replace',
          idempotencyKey: 'idempotency-replace',
          command: {
            operation: 'replace',
            sessionId: 'session-target',
            expectedRunId: 'run-active',
            input: { text: 'Do this instead.', attachmentIds: [] },
          },
        },
      }).pipe(
        Effect.provideService(SessionControlOperationJournal, {
          claim: (input) =>
            Effect.sync(() => {
              claims.push(input)
              return {
                status: 'completed',
                replayed: false,
                outcome: {
                  operation: 'replace',
                  effect: 'rejected',
                  sessionId: 'session-target',
                  ...sessionHostRefusal('host_run_ceiling_reached'),
                },
              } as const
            }),
          complete: () => Effect.die('a refused claim completes nothing'),
        }),
        Effect.provide(setup.layer),
      ),
    )

    expect(claims[0]?.replacementRun).toEqual({
      caller: { callerId: 'transient-mcp:digest-agent', idempotencyKey: 'idempotency-replace' },
      hostRunCeiling: 7,
    })
    expect(response.outcome).toMatchObject({ effect: 'rejected', code: 'host_run_ceiling_reached' })
    expect(setup.interrupt).not.toHaveBeenCalled()
  })
})
