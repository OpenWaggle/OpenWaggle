import * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import { afterEach, describe, expect, it } from 'vitest'
import { SessionControlAttachmentService } from '../../ports/session-control-attachment-service'
import {
  cleanupAttachmentFixtures,
  fixture,
  testLayer,
} from './session-control-attachment-test-support'

afterEach(cleanupAttachmentFixtures)

describe('Session Control attachments of queued steers', () => {
  it('retains a queued steer attachment until its Run settles', async () => {
    const input = await fixture()
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* SessionControlAttachmentService
        const [attachment] = yield* service.prepare({
          baseDirectory: input.root,
          entries: [{ path: input.source }],
          ownerCallerId: 'session-agent:parent',
          requestId: 'steer',
        })
        if (!attachment) return yield* Effect.die('Expected a prepared attachment.')
        yield* service.bind({
          attachmentIds: [attachment.id],
          sessionId: 'session-a',
          ownerCallerId: 'session-agent:parent',
        })
        const sql = yield* SqlClient.SqlClient
        yield* sql`
          INSERT INTO session_runs (id, session_id, status, intent_json)
          VALUES (${'run-a'}, ${'session-a'}, ${'active'}, ${JSON.stringify({ attachmentIds: [] })})
        `
        yield* sql`
          INSERT INTO session_operations (operation, target_scope, request_json, status, outcome_json)
          VALUES (
            ${'steer'}, ${'session-a'},
            ${JSON.stringify({
              operation: 'steer',
              sessionId: 'session-a',
              expectedRunId: 'run-a',
              input: { text: 'Look at this.', attachmentIds: [attachment.id] },
            })},
            ${'completed'},
            ${JSON.stringify({ operation: 'steer', effect: 'steered-run', runId: 'run-a' })}
          )
        `
        const count = sql<{ readonly count: number }>`
          SELECT COUNT(*) AS count FROM session_prepared_attachments
        `.pipe(Effect.map((rows) => rows[0]?.count))
        yield* service.cleanupUnreferenced({ sessionId: 'session-a' })
        const whileLive = yield* count
        yield* sql`UPDATE session_runs SET status = ${'interrupted'} WHERE id = ${'run-a'}`
        yield* service.cleanupUnreferenced({ sessionId: 'session-a' })
        return { whileLive, afterSettlement: yield* count }
      }).pipe(Effect.provide(testLayer(input.databasePath))),
    )

    expect(result).toEqual({ whileLive: 1, afterSettlement: 0 })
  })
})
