import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import { SESSION_CONTROL_CONTRACT_VERSION } from '@shared/types/session-control'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  queueSessionFollowUp,
  submitSessionMessage,
} from '../../application/session-control-service'
import { makeSessionControlTestLayer } from './sqlite-session-control-test-layer'

let temporaryRoot = ''

describe('SQLite Session Control queued Waggle intent', () => {
  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-session-control-waggle-'))
  })

  afterEach(async () => {
    if (temporaryRoot) await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  it('round-trips the invocation through durable intent JSON', async () => {
    const layer = makeSessionControlTestLayer(path.join(temporaryRoot, 'session-host.sqlite'))
    const waggle = {
      presetId: 'preset-review',
      presetName: 'Review pair',
      source: 'user' as const,
      config: {
        mode: 'sequential' as const,
        agents: [
          {
            label: 'Builder',
            model: '$inherit',
            roleDescription: 'Implements',
            color: 'blue' as const,
          },
          {
            label: 'Reviewer',
            model: 'openai/gpt-5',
            roleDescription: 'Reviews',
            color: 'amber' as const,
          },
        ] as const,
        stop: { primary: 'consensus' as const, maxTurnsSafety: 4 },
      },
    }

    const intentJson = await Effect.runPromise(
      Effect.gen(function* () {
        yield* submitSessionMessage({
          callerId: 'local-user',
          request: {
            contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
            requestId: 'request-start-waggle-queue',
            idempotencyKey: 'idempotency-start-waggle-queue',
            command: {
              operation: 'message',
              sessionId: 'session-target',
              input: { text: 'Start working.', attachmentIds: [] },
            },
          },
        })
        yield* queueSessionFollowUp({
          callerId: 'local-user',
          request: {
            contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
            requestId: 'request-queue-waggle',
            idempotencyKey: 'idempotency-queue-waggle',
            command: {
              operation: 'follow-up',
              sessionId: 'session-target',
              input: { text: 'Review next.', attachmentIds: [], waggle },
            },
          },
        })
        const sql = yield* SqlClient.SqlClient
        const rows = yield* sql<{ readonly intent_json: string }>`
          SELECT intent_json FROM session_follow_ups WHERE id = ${'follow-up-next'}
        `
        return rows[0]?.intent_json
      }).pipe(Effect.provide(layer)),
    )

    expect(JSON.parse(intentJson ?? '{}').waggle).toEqual(waggle)
  })
})
