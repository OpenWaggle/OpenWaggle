import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import type { AgentAuthorizationMode } from '@shared/types/agent-authorization'
import { SessionId } from '@shared/types/brand'
import {
  SESSION_CONTROL_CONTRACT_VERSION,
  type SessionControlMessageInput,
} from '@shared/types/session-control'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  queueSessionFollowUp,
  submitSessionMessage,
} from '../../application/session-control-service'
import { SessionSettingsRepository } from '../../ports/session-settings-repository'
import { SqliteSessionSettingsRepositoryLive } from '../sqlite-session-settings-repository'
import { makeSessionControlTestLayer } from './sqlite-session-control-test-layer'

const TARGET = SessionId('session-target')
const CALLER = 'gui:local-user'
const PROFILE = { modelId: 'openai/gpt-5.4', thinkingLevel: 'medium', tools: ['read'] }

function layer(databasePath: string) {
  return SqliteSessionSettingsRepositoryLive.pipe(
    Layer.provideMerge(makeSessionControlTestLayer(databasePath)),
  )
}

function seedProfile() {
  return Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    yield* sql`
      INSERT INTO session_execution_profiles (
        session_id, profile_json, authority_origin_caller_id, authorization_ceiling,
        created_at, updated_at
      ) VALUES (${TARGET}, ${JSON.stringify(PROFILE)}, ${CALLER}, ${'yolo'}, ${1}, ${1})
    `
  })
}

function message(
  key: string,
  input: Partial<SessionControlMessageInput> = {},
  runAuthorizationOverride?: AgentAuthorizationMode,
) {
  return submitSessionMessage({
    callerId: CALLER,
    request: {
      contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
      requestId: `request-${key}`,
      idempotencyKey: `idempotency-${key}`,
      command: {
        operation: 'message',
        sessionId: TARGET,
        ...(runAuthorizationOverride ? { runAuthorizationOverride } : {}),
        input: { text: key, attachmentIds: [], ...input },
      },
    },
  })
}

function followUp(key: string) {
  return queueSessionFollowUp({
    callerId: CALLER,
    request: {
      contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
      requestId: `request-${key}`,
      idempotencyKey: `idempotency-${key}`,
      command: {
        operation: 'follow-up',
        sessionId: TARGET,
        input: { text: key, attachmentIds: [] },
      },
    },
  })
}

function storedRows() {
  return Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const runs = yield* sql<{ readonly intent_json: string }>`
      SELECT intent_json FROM session_runs WHERE session_id = ${TARGET}
    `
    const followUps = yield* sql<{ readonly intent_json: string }>`
      SELECT intent_json FROM session_follow_ups WHERE session_id = ${TARGET} ORDER BY position
    `
    const profiles = yield* sql<{ readonly profile_json: string }>`
      SELECT profile_json FROM session_execution_profiles WHERE session_id = ${TARGET}
    `
    const parse = (json: string): unknown => JSON.parse(json)
    return {
      runIntents: runs.map((row) => parse(row.intent_json)),
      followUpIntents: followUps.map((row) => parse(row.intent_json)),
      profile: parse(profiles[0]?.profile_json ?? 'null'),
    }
  })
}

describe('Session settings placement on SQLite Session Control', () => {
  let temporaryRoot = ''

  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-settings-placement-'))
  })

  afterEach(async () => {
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  it('takes Session settings only on the message that starts a Run, never on a Follow-up', async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        yield* seedProfile()
        const settings = yield* SessionSettingsRepository
        const started = yield* message('Start.', { thinkingLevel: 'high' }, 'yolo')
        // Admitting the Run made its level the Session's in the same transaction.
        const profileAtStart = (yield* storedRows()).profile
        const queuedWithThinking = yield* message('Later with thinking.', { thinkingLevel: 'low' })
        const queuedWithOverride = yield* message('Later with access.', {}, 'ask-for-approval')
        const queued = yield* followUp('Afterwards.')
        const changeWhileActive = yield* settings.setThinkingLevel(TARGET, 'minimal')
        return {
          started: started.outcome,
          profileAtStart,
          queuedWithThinking: queuedWithThinking.outcome,
          queuedWithOverride: queuedWithOverride.outcome,
          queued: queued.outcome,
          changeWhileActive,
          rows: yield* storedRows(),
        }
      }).pipe(Effect.provide(layer(path.join(temporaryRoot, 'placement.sqlite')))),
    )

    expect(result.started).toMatchObject({ operation: 'message', effect: 'started-run' })
    expect(result.profileAtStart).toEqual({ ...PROFILE, thinkingLevel: 'high' })
    expect(result.rows.runIntents).toEqual([
      expect.objectContaining({ thinkingLevel: 'high', runAuthorizationOverride: 'yolo' }),
    ])
    expect(result.queuedWithThinking).toMatchObject({
      effect: 'rejected',
      code: 'thinking_level_requires_idle_session',
    })
    expect(result.queuedWithOverride).toMatchObject({
      effect: 'rejected',
      code: 'run_authorization_override_requires_idle_session',
    })
    expect(result.queued).toMatchObject({ effect: 'queued-follow-up' })
    expect(result.changeWhileActive).toEqual({ changed: false, code: 'session_run_active' })
    expect(result.rows.followUpIntents).toHaveLength(1)
    expect(result.rows.followUpIntents[0]).not.toHaveProperty('thinkingLevel')
    expect(result.rows.followUpIntents[0]).not.toHaveProperty('runAuthorizationOverride')
    // The Session keeps the level its Run started with; the override was never saved.
    expect(result.rows.profile).toEqual({ ...PROFILE, thinkingLevel: 'high' })
  })
})
