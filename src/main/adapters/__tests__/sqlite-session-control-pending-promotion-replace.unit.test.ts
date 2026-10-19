import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { SESSION_CONTROL_CONTRACT_VERSION } from '@shared/types/session-control'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionControlOperationJournal } from '../../ports/session-control-operation-journal'
import { SqliteSessionControlOperationJournalLive } from '../sqlite-session-control-operation-journal'
import { makeSessionControlRunLifecycleTestLayer } from './sqlite-session-control-run-lifecycle-test-layer'

const promote = {
  contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
  requestId: 'request-promote',
  idempotencyKey: 'idempotency-promote',
  command: {
    operation: 'promote',
    sessionId: 'session-target',
    expectedRunId: 'run-next',
    followUpId: 'follow-up-next',
  },
} as const

const replace = {
  contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
  requestId: 'request-replace',
  idempotencyKey: 'idempotency-replace',
  command: {
    operation: 'replace',
    sessionId: 'session-target',
    expectedRunId: 'run-next',
    input: { text: 'Start over.', attachmentIds: [] },
  },
} as const

describe('SQLite Session Control replacement during a pending promotion', () => {
  let temporaryRoot = ''

  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-pending-promotion-'))
  })

  afterEach(async () => {
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  it('refuses a replacement while a promotion waits for delivery, and admits it afterwards', async () => {
    // A replacement waits for the Run to settle while it holds the Session's locks, so a promotion
    // that stepped aside from them could not complete, the Run's settlement failed on the
    // reservation, and the already-steered Follow-up stayed queued for a second delivery.
    const layer = SqliteSessionControlOperationJournalLive.pipe(
      Layer.provideMerge(
        makeSessionControlRunLifecycleTestLayer(path.join(temporaryRoot, 'journal.sqlite')),
      ),
    )
    const decideReplace = vi.fn(() => ({ accepted: true }) as const)
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const journal = yield* SessionControlOperationJournal
        const promotion = yield* journal.claim({
          callerId: 'local-user',
          request: promote,
          decide: () => ({ accepted: true }),
        })
        const refused = yield* journal.claim({
          callerId: 'local-user',
          request: replace,
          decide: decideReplace,
        })
        yield* journal.complete({
          callerId: 'local-user',
          request: promote,
          outcome: {
            operation: 'promote',
            effect: 'rejected',
            sessionId: 'session-target',
            code: 'run_not_live',
          },
        })
        const admitted = yield* journal.claim({
          callerId: 'local-user',
          request: { ...replace, requestId: 'request-replace-retry', idempotencyKey: 'retry' },
          decide: decideReplace,
        })
        return { promotion, refused, admitted }
      }).pipe(Effect.provide(layer)),
    )

    expect(result.promotion.status).toBe('claimed')
    expect(result.refused).toEqual({
      status: 'completed',
      replayed: false,
      outcome: {
        operation: 'replace',
        effect: 'rejected',
        sessionId: 'session-target',
        code: 'follow_up_reserved',
      },
    })
    expect(result.admitted.status).toBe('claimed')
    expect(decideReplace).toHaveBeenCalledOnce()
  })
})
