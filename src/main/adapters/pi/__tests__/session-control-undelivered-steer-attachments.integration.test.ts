import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SessionControlAttachmentService } from '../../../ports/session-control-attachment-service'
import {
  directSteer,
  liveSession,
  makeRuntime,
  SESSION_ID,
  STEER_CALLER_ID,
  settle,
  startRunWithFollowUps,
} from './session-control-undelivered-steering.test-support'

function prepareAttachment(root: string, name: string) {
  return Effect.gen(function* () {
    const source = path.join(root, `${name}.txt`)
    yield* Effect.promise(() => fs.writeFile(source, `Evidence for ${name}.`))
    const attachments = yield* SessionControlAttachmentService
    const [prepared] = yield* attachments.prepare({
      baseDirectory: root,
      entries: [{ path: source }],
      ownerCallerId: STEER_CALLER_ID,
      requestId: `prepare-${name}`,
    })
    if (!prepared) return yield* Effect.die('Expected a prepared attachment.')
    return prepared.id
  })
}

const storedAttachmentIds = SqlClient.SqlClient.pipe(
  Effect.flatMap(
    (sql) => sql<{ readonly id: string }>`SELECT id FROM session_prepared_attachments ORDER BY id`,
  ),
  Effect.map((rows) => rows.map((row) => row.id)),
)

const cleanupUnreferenced = SessionControlAttachmentService.pipe(
  Effect.flatMap((attachments) => attachments.cleanupUnreferenced({ sessionId: SESSION_ID })),
)

describe('Attachments of Undelivered steering messages', () => {
  let temporaryRoot = ''
  let unregister: (() => void) | undefined

  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-steer-attachments-'))
  })

  afterEach(async () => {
    unregister?.()
    unregister = undefined
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  async function steerTwoAttachedMessages() {
    const runtime = makeRuntime(path.join(temporaryRoot, 'attachments.sqlite'), {
      storedAttachments: true,
    })
    const live = liveSession()
    await runtime.runPromise(startRunWithFollowUps())
    unregister = live.register()
    const ids = await runtime.runPromise(
      Effect.all({
        delivered: prepareAttachment(temporaryRoot, 'delivered'),
        returned: prepareAttachment(temporaryRoot, 'returned'),
      }),
    )
    await runtime.runPromise(
      directSteer('Read this first.', { key: 'delivered', attachmentIds: [ids.delivered] }),
    )
    await runtime.runPromise(
      directSteer('Read this later.', { key: 'returned', attachmentIds: [ids.returned] }),
    )
    const deliveredText = live.steer.mock.calls[0]?.[0]
    if (deliveredText === undefined) throw new Error('Pi never received the first steer.')
    live.incorporate(deliveredText)
    // Both stay while the Run is live: either could still come back.
    await runtime.runPromise(cleanupUnreferenced)
    const whileLive = await runtime.runPromise(storedAttachmentIds)
    return { runtime, ids, whileLive }
  }

  it('keeps a returned steer its attachments and releases the delivered one at settlement', async () => {
    const { runtime, ids, whileLive } = await steerTwoAttachedMessages()
    unregister?.()
    unregister = undefined

    const result = await runtime.runPromise(settle('interrupted'))
    const afterSettlement = await runtime.runPromise(storedAttachmentIds)
    await runtime.runPromise(cleanupUnreferenced)
    const afterCleanup = await runtime.runPromise(storedAttachmentIds)
    await runtime.dispose()

    expect(whileLive).toEqual([ids.delivered, ids.returned].sort())
    expect(result.queue[0]).toMatchObject({
      text: 'Read this later.',
      attachmentIds: [ids.returned],
    })
    expect(afterSettlement).toEqual([ids.returned])
    expect(afterCleanup).toEqual([ids.returned])
  })

  it('keeps both through a pending replacement and releases the delivered one after it', async () => {
    const { runtime, ids, whileLive } = await steerTwoAttachedMessages()
    await runtime.runPromise(
      SqlClient.SqlClient.pipe(
        Effect.flatMap((sql) =>
          sql`
            INSERT INTO session_operations (
              caller_id, operation, target_scope, idempotency_key, request_json,
              status, outcome_json, created_at, updated_at
            ) VALUES (
              ${'local-user'}, ${'replace'}, ${SESSION_ID}, ${'replace-key'},
              ${JSON.stringify({ operation: 'replace', sessionId: SESSION_ID, expectedRunId: 'run-next' })},
              ${'pending'}, ${null}, ${1000}, ${1000}
            )
          `.pipe(
            Effect.zipRight(
              sql`UPDATE session_runs SET status = ${'stopping'} WHERE id = ${'run-next'}`,
            ),
          ),
        ),
      ),
    )
    unregister?.()
    unregister = undefined

    const result = await runtime.runPromise(settle('interrupted'))
    await runtime.runPromise(cleanupUnreferenced)
    const duringReplacement = await runtime.runPromise(storedAttachmentIds)
    // The replacement completes: the interrupted Run leaves its live statuses.
    await runtime.runPromise(
      SqlClient.SqlClient.pipe(
        Effect.flatMap(
          (sql) => sql`UPDATE session_runs SET status = ${'interrupted'} WHERE id = ${'run-next'}`,
        ),
      ),
    )
    await runtime.runPromise(cleanupUnreferenced)
    const afterReplacement = await runtime.runPromise(storedAttachmentIds)
    await runtime.dispose()

    expect(whileLive).toEqual([ids.delivered, ids.returned].sort())
    expect(result.settlement).toMatchObject({ accepted: false, code: 'run_not_active' })
    expect(result.queue[0]).toMatchObject({ attachmentIds: [ids.returned] })
    expect(duringReplacement).toEqual([ids.delivered, ids.returned].sort())
    expect(afterReplacement).toEqual([ids.returned])
  })
})
