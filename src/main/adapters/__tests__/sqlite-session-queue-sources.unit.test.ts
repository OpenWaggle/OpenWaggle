import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import type { LocalSessionProfileAuthority } from '@shared/types/local-session-profile'
import type { SessionQueryOutcome } from '@shared/types/session-query'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readQueue } from '../sqlite-session-query-details'
import { followUpEditLayer, SESSION, USER } from './sqlite-follow-up-edit-hold.test-support'

const QUEUE_REQUEST = {
  contractVersion: 2,
  requestId: 'queue',
  query: { operation: 'queue-list', sessionId: SESSION, includeBodies: true },
} as const

let tmpRoot = ''

function queueSources(outcome: SessionQueryOutcome) {
  if (outcome.operation !== 'queue-list' || !('items' in outcome)) {
    throw new Error('expected a queue list')
  }
  return outcome.items.map((item) => item.source)
}

const queuedFromEverySource = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql`
    INSERT INTO session_client_profiles (
      id, name, credential_verifier, capabilities_json, scope_json, authorization_ceiling,
      created_at, updated_at
    ) VALUES (
      ${'profile-ci'}, ${'ci-bot'}, ${'verifier'}, ${'[]'}, ${'{"all":true}'},
      ${'ask-for-approval'}, ${1}, ${1}
    )
  `
  const intents = [
    { id: 'from-desktop', callerId: USER },
    { id: 'from-agent', callerId: 'session-agent:session-release:run-7' },
    { id: 'from-profile', callerId: 'profile:profile-ci' },
    { id: 'from-unknown-profile', callerId: 'profile:profile-gone' },
    { id: 'from-mcp', callerId: 'transient-mcp:client-1' },
    // Sent as the desktop user (queue-adopt): the source stays the profile that queued it.
    { id: 'adopted', callerId: USER, authorCallerId: 'profile:profile-ci' },
  ]
  for (const [position, intent] of intents.entries()) {
    yield* sql`
      INSERT INTO session_follow_ups (
        id, session_id, position, delivery_state, intent_json, created_at, updated_at
      ) VALUES (
        ${intent.id}, ${SESSION}, ${position}, ${'pending'},
        ${JSON.stringify({
          text: intent.id,
          attachmentIds: [],
          acceptedAt: position,
          idempotencyKey: `key-${intent.id}`,
          ...intent,
        })},
        ${1}, ${1}
      )
    `
  }
  return sql
})

describe('queue-list Follow-up sources', () => {
  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-queue-sources-'))
  })

  afterEach(async () => {
    if (tmpRoot) await fs.rm(tmpRoot, { recursive: true, force: true })
  })

  it('names the author, its agent Session, and, for the desktop user, its CLI profile', async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* queuedFromEverySource
        const desktop = yield* readQueue(sql, QUEUE_REQUEST, { callerId: USER, desktopUser: true })
        const agent = yield* readQueue(sql, QUEUE_REQUEST, {
          callerId: 'session-agent:queen:run',
          desktopUser: false,
        })
        return { desktop, agent }
      }).pipe(Effect.provide(followUpEditLayer(tmpRoot, 'sources.sqlite'))),
    )

    expect(queueSources(result.desktop.outcome)).toEqual([
      { callerId: USER },
      { callerId: 'session-agent:session-release:run-7', sessionId: 'session-release' },
      { callerId: 'profile:profile-ci', profileName: 'ci-bot' },
      { callerId: 'profile:profile-gone' },
      { callerId: 'transient-mcp:client-1' },
      { callerId: 'profile:profile-ci', profileName: 'ci-bot' },
    ])
    expect(queueSources(result.agent.outcome)[2]).toEqual({ callerId: 'profile:profile-ci' })
  })

  it('titles an agent Session source the caller may see, archived or in another project', async () => {
    const scoped = (
      scope: LocalSessionProfileAuthority['scope'],
    ): LocalSessionProfileAuthority => ({
      profileId: 'profile-reader',
      profileName: 'reader',
      capabilities: ['sessions:read'],
      scope,
      authorizationCeiling: 'ask-for-approval',
    })
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql`
          INSERT INTO sessions (id, project_path, title, archived) VALUES
            (${'session-release'}, ${'/other-project'}, ${'Release prep'}, ${1})
        `
        for (const [position, callerId] of [
          'session-agent:session-release:run-7',
          'session-agent:session-deleted:run-2',
        ].entries()) {
          yield* sql`
            INSERT INTO session_follow_ups (
              id, session_id, position, delivery_state, intent_json, created_at, updated_at
            ) VALUES (
              ${`item-${position}`}, ${SESSION}, ${position}, ${'pending'},
              ${JSON.stringify({
                text: 'From an agent',
                attachmentIds: [],
                acceptedAt: position,
                idempotencyKey: `key-${position}`,
                callerId,
              })},
              ${1}, ${1}
            )
          `
        }
        const desktop = yield* readQueue(sql, QUEUE_REQUEST, { callerId: USER, desktopUser: true })
        const reaching = yield* readQueue(sql, QUEUE_REQUEST, {
          callerId: 'profile:profile-reader',
          desktopUser: false,
          authority: scoped({ projectPaths: ['/project', '/other-project'] }),
        })
        const narrow = yield* readQueue(sql, QUEUE_REQUEST, {
          callerId: 'profile:profile-reader',
          desktopUser: false,
          authority: scoped({ projectPaths: ['/project'] }),
        })
        return { desktop, reaching, narrow }
      }).pipe(Effect.provide(followUpEditLayer(tmpRoot, 'titles.sqlite'))),
    )

    const titled = {
      callerId: 'session-agent:session-release:run-7',
      sessionId: 'session-release',
      sessionTitle: 'Release prep',
    }
    const deleted = {
      callerId: 'session-agent:session-deleted:run-2',
      sessionId: 'session-deleted',
    }
    expect(queueSources(result.desktop.outcome)).toEqual([titled, deleted])
    expect(queueSources(result.reaching.outcome)).toEqual([titled, deleted])
    // Out of reach: the Session id stays, its title does not leak.
    expect(queueSources(result.narrow.outcome)).toEqual([
      { callerId: titled.callerId, sessionId: titled.sessionId },
      deleted,
    ])
  })
})
