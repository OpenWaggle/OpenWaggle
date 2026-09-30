import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import { RunId, SessionId } from '@shared/types/brand'
import { SESSION_CONTROL_CONTRACT_VERSION } from '@shared/types/session-control'
import * as Effect from 'effect/Effect'
import { afterEach, describe, expect, it } from 'vitest'
import { submitSessionMessage } from '../../application/session-control-service'
import { SessionControlRunLifecycleRepository } from '../../ports/session-control-run-lifecycle-repository'
import { makeSessionControlRunLifecycleTestLayer } from './sqlite-session-control-run-lifecycle-test-layer'

const PROFILE_JSON = '{"modelId":"provider/model","thinkingLevel":"medium"}'

describe('SQLite queued Follow-up from another project', () => {
  let temporaryRoot = ''

  afterEach(async () => {
    if (temporaryRoot) await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  async function settleCrossProjectFollowUp(origin: {
    readonly callerId: string
    readonly profileScope?: object
    /** Raw `authority_scope_snapshot_json` stored for the source Session. */
    readonly snapshotJson?: string
    /** The origin profile's scope after the Follow-up was queued and before it is delivered. */
    readonly profileScopeAtDelivery?: object
    /** Who started the source's Run; defaults to the source's own origin. */
    readonly runInitiatorCallerId?: string
  }) {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-follow-up-cross-project-'))
    const layer = makeSessionControlRunLifecycleTestLayer(
      path.join(temporaryRoot, 'cross-project.sqlite'),
    )
    return Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        // The layer's target lives in /project; the source is a root in another repository.
        yield* sql`INSERT INTO sessions (id, project_path) VALUES (${'source'}, ${'/other'})`
        const sourceIntent = JSON.stringify({
          callerId: origin.runInitiatorCallerId ?? origin.callerId,
        })
        yield* sql`
          INSERT INTO session_runs (id, session_id, status, intent_json, created_at, updated_at)
          VALUES
            (${'run-source'}, ${'source'}, ${'active'}, ${sourceIntent}, ${1}, ${1}),
            (${'run-active'}, ${'session-target'}, ${'active'}, ${null}, ${2}, ${2})
        `
        yield* sql`
          INSERT INTO session_execution_profiles (
            session_id, profile_json, authority_origin_caller_id,
            authorization_ceiling, created_at, updated_at
          ) VALUES (
            ${'source'}, ${PROFILE_JSON}, ${origin.callerId}, ${'ask-for-approval'}, ${1}, ${1}
          )
        `
        if (origin.profileScope) {
          yield* sql`
            INSERT INTO session_client_profiles (
              id, name, credential_verifier, capabilities_json, scope_json,
              authorization_ceiling, created_at, updated_at
            ) VALUES (
              ${'origin'}, ${'origin'}, ${'verifier'},
              ${JSON.stringify(['sessions:message'])}, ${JSON.stringify(origin.profileScope)},
              ${'ask-for-approval'}, ${1}, ${1}
            )
          `
        }
        yield* sql`
          UPDATE session_control_states SET active_run_id = ${'run-active'}
          WHERE session_id = ${'session-target'}
        `
        yield* submitSessionMessage({
          callerId: 'session-agent:source:run-source',
          request: {
            contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
            requestId: 'queue-cross-project',
            idempotencyKey: 'queue-cross-project-once',
            command: {
              // A message to a busy Session queues as a Follow-up.
              operation: 'message',
              sessionId: 'session-target',
              input: { text: 'Report from the other repository.', attachmentIds: [] },
            },
          },
        })
        // Stored after queueing: this test is about the delivery-time decision only, and the
        // queueing path validates a snapshot against a real Workspace binding.
        if (origin.snapshotJson !== undefined) {
          yield* sql`
            UPDATE session_execution_profiles
            SET authority_scope_snapshot_json = ${origin.snapshotJson}
            WHERE session_id = ${'source'}
          `
        }
        if (origin.profileScopeAtDelivery) {
          yield* sql`
            UPDATE session_client_profiles
            SET scope_json = ${JSON.stringify(origin.profileScopeAtDelivery)}
            WHERE id = ${'origin'}
          `
        }
        const lifecycle = yield* SessionControlRunLifecycleRepository
        const settled = yield* lifecycle.settle({
          sessionId: SessionId('session-target'),
          runId: RunId('run-active'),
          nextRunId: RunId('run-after'),
          terminalStatus: 'completed',
        })
        const followUps = yield* sql<{
          readonly delivery_state: string
          readonly attention_reason: string | null
        }>`SELECT delivery_state, attention_reason FROM session_follow_ups`
        return { settled, followUp: followUps[0] }
      }).pipe(Effect.provide(layer)),
    )
  }

  it('delivers a Follow-up queued by a user-originated root in another project', async () => {
    const result = await settleCrossProjectFollowUp({ callerId: 'gui:local-user' })

    expect(result).toMatchObject({
      settled: { accepted: true, scheduled: { runId: RunId('run-after') } },
      followUp: undefined,
    })
  })

  it('delivers a Follow-up queued by a root born from a catalog-wide profile', async () => {
    const result = await settleCrossProjectFollowUp({
      callerId: 'profile:origin',
      profileScope: { all: true },
    })

    expect(result).toMatchObject({
      settled: { accepted: true, scheduled: { runId: RunId('run-after') } },
      followUp: undefined,
    })
  })

  // A root from a named profile is pinned to its own project even when the profile lists
  // several, so listing the target project in the profile is not enough.
  it('pauses a Follow-up from a root of a multi-project profile', async () => {
    const result = await settleCrossProjectFollowUp({
      callerId: 'profile:origin',
      profileScope: { projectPaths: ['/other', '/project'] },
    })

    expect(result).toMatchObject({
      settled: { accepted: true },
      followUp: { delivery_state: 'needs_attention', attention_reason: 'authority_changed' },
    })
    expect(result.settled).not.toHaveProperty('scheduled')
  })

  const paused = {
    settled: { accepted: true },
    followUp: { delivery_state: 'needs_attention', attention_reason: 'authority_changed' },
  }

  // A project-scoped caller must not borrow a desktop Session's reach by messaging it.
  it('pauses when a project-scoped profile started the desktop root Run that queued it', async () => {
    const result = await settleCrossProjectFollowUp({
      callerId: 'gui:local-user',
      runInitiatorCallerId: 'profile:origin',
      profileScope: { projectPaths: ['/other'] },
    })

    expect(result).toMatchObject(paused)
    expect(result.settled).not.toHaveProperty('scheduled')
  })

  it('pauses when the origin profile was narrowed after the Follow-up was queued', async () => {
    const result = await settleCrossProjectFollowUp({
      callerId: 'profile:origin',
      profileScope: { all: true },
      profileScopeAtDelivery: { projectPaths: ['/other'] },
    })

    expect(result).toMatchObject(paused)
    expect(result.settled).not.toHaveProperty('scheduled')
  })

  // Settlement used to fail on the decode error, so the target never started its next Run.
  it('pauses instead of failing settlement when the stored snapshot is unreadable', async () => {
    const result = await settleCrossProjectFollowUp({
      callerId: 'gui:local-user',
      snapshotJson: '{"scope": "not a scope"}',
    })

    expect(result).toMatchObject(paused)
    expect(result.settled).not.toHaveProperty('scheduled')
  })
})
