import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import { RunId, SessionId, SupportedModelId } from '@shared/types/brand'
import { SESSION_CONTROL_CONTRACT_VERSION } from '@shared/types/session-control'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { submitSessionMessage } from '../../application/session-control-service'
import { SessionSettingsRepository } from '../../ports/session-settings-repository'
import { SqliteSessionSettingsRepositoryLive } from '../sqlite-session-settings-repository'
import { makeSessionControlTestLayer } from './sqlite-session-control-test-layer'

const TARGET = SessionId('session-target')
const OTHER = SessionId('session-other')
const PROFILE = {
  modelId: 'openai/gpt-5.4',
  thinkingLevel: 'medium',
  agentDefinitionName: 'reviewer',
  tools: ['read'],
}

function layer(databasePath: string) {
  return SqliteSessionSettingsRepositoryLive.pipe(
    Layer.provideMerge(makeSessionControlTestLayer(databasePath)),
  )
}

function seedProfiles() {
  return Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    yield* sql`INSERT INTO sessions (id, project_path) VALUES (${OTHER}, ${'/project'})`
    for (const sessionId of [TARGET, OTHER]) {
      yield* sql`
        INSERT INTO session_execution_profiles (
          session_id, profile_json, authority_origin_caller_id, authorization_ceiling,
          created_at, updated_at
        ) VALUES (
          ${sessionId}, ${JSON.stringify(PROFILE)}, ${'gui:local-user'}, ${'yolo'}, ${1}, ${1}
        )
      `
    }
  })
}

function profile(sessionId: SessionId) {
  return Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const rows = yield* sql<{ readonly profile_json: string }>`
      SELECT profile_json FROM session_execution_profiles WHERE session_id = ${sessionId}
    `
    const parsed: unknown = JSON.parse(rows[0]?.profile_json ?? 'null')
    return parsed
  })
}

function startRun(text: string) {
  return submitSessionMessage({
    callerId: 'gui:local-user',
    request: {
      contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
      requestId: `request-${text}`,
      idempotencyKey: `idempotency-${text}`,
      command: { operation: 'message', sessionId: TARGET, input: { text, attachmentIds: [] } },
    },
  })
}

describe('SQLite Session settings', () => {
  let temporaryRoot = ''

  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-session-settings-'))
  })

  afterEach(async () => {
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  it('changes an idle Session thinking level and model without touching another Session', async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        yield* seedProfiles()
        const settings = yield* SessionSettingsRepository
        const thinking = yield* settings.setThinkingLevel(TARGET, 'high')
        const model = yield* settings.setModel(
          TARGET,
          SupportedModelId('anthropic/claude-sonnet-4-5'),
        )
        return { thinking, model, target: yield* profile(TARGET), other: yield* profile(OTHER) }
      }).pipe(Effect.provide(layer(path.join(temporaryRoot, 'idle.sqlite')))),
    )

    expect(result.thinking).toEqual({ changed: true })
    expect(result.model).toEqual({ changed: true })
    expect(result.target).toEqual({
      ...PROFILE,
      modelId: 'anthropic/claude-sonnet-4-5',
      thinkingLevel: 'high',
    })
    expect(result.other).toEqual(PROFILE)
  })

  it('refuses a model or thinking change while a Run is active, and applies a Run start level', async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        yield* seedProfiles()
        yield* startRun('Start working.')
        const settings = yield* SessionSettingsRepository
        const thinking = yield* settings.setThinkingLevel(TARGET, 'high')
        const model = yield* settings.setModel(TARGET, SupportedModelId('openai/gpt-5.5'))
        const otherRun = yield* settings.applyRunStartThinkingLevel({
          sessionId: TARGET,
          runId: RunId('run-other'),
          thinkingLevel: 'low',
        })
        const ownRun = yield* settings.applyRunStartThinkingLevel({
          sessionId: TARGET,
          runId: RunId('run-next'),
          thinkingLevel: 'max',
        })
        return { thinking, model, otherRun, ownRun, target: yield* profile(TARGET) }
      }).pipe(Effect.provide(layer(path.join(temporaryRoot, 'active.sqlite')))),
    )

    expect(result.thinking).toEqual({ changed: false, code: 'session_run_active' })
    expect(result.model).toEqual({ changed: false, code: 'session_run_active' })
    expect(result.otherRun).toBe(false)
    expect(result.ownRun).toBe(true)
    expect(result.target).toEqual({ ...PROFILE, thinkingLevel: 'max' })
  })

  it('reports a Session without an execution profile', async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const settings = yield* SessionSettingsRepository
        return yield* settings.setThinkingLevel(TARGET, 'high')
      }).pipe(Effect.provide(layer(path.join(temporaryRoot, 'missing.sqlite')))),
    )

    expect(result).toEqual({ changed: false, code: 'session_profile_not_found' })
  })
})
