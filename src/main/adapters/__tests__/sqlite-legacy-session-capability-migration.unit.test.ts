import * as SqlClient from '@effect/sql/SqlClient'
import {
  DEFAULT_SESSION_AGENT_CAPABILITIES,
  type SessionCapability,
} from '@shared/types/session-capability'
import * as Effect from 'effect/Effect'
import { describe, expect, it } from 'vitest'
import {
  migrateLegacySessionCapabilityGrants,
  restoreSessionCapabilityGrants,
  SESSION_CAPABILITY_GRANTS_RESTORED_KEY,
} from '../sqlite-legacy-session-capability-migration'
import {
  AFTER,
  agentCreated,
  BEFORE,
  forked,
  LEGACY,
  run,
  seedProfile,
  spawned,
  storedCapabilities,
  useLegacyCapabilityDatabase,
} from './sqlite-legacy-session-capability-migration.test-support'

const withoutManage = DEFAULT_SESSION_AGENT_CAPABILITIES.filter(
  (capability) => capability !== 'schedules:manage',
)

describe('legacy Session capability migration', () => {
  useLegacyCapabilityDatabase()

  it('gives the default grant back to Sessions made before Scheduled tasks and what their agents made', async () => {
    const stored = await run(
      Effect.gen(function* () {
        yield* seedProfile({ id: 'queen', capabilities: LEGACY, createdAt: BEFORE })
        // The queen's agent created a root after the upgrade; that root's agent created another.
        yield* seedProfile({ id: 'created', capabilities: LEGACY, createdAt: AFTER })
        yield* agentCreated('created', 'queen')
        yield* seedProfile({ id: 'created-again', capabilities: LEGACY, createdAt: AFTER + 1 })
        yield* agentCreated('created-again', 'created')
        yield* seedProfile({ id: 'fork', capabilities: LEGACY, createdAt: AFTER })
        yield* forked('fork', 'queen')
        yield* seedProfile({ id: 'worker', capabilities: LEGACY, createdAt: AFTER })
        yield* spawned('worker', 'queen')
        yield* seedProfile({
          id: 'desktop',
          capabilities: DEFAULT_SESSION_AGENT_CAPABILITIES,
          createdAt: AFTER,
        })
        yield* seedProfile({ id: 'unrestricted', createdAt: AFTER })
        expect(yield* restoreSessionCapabilityGrants()).toBe(6)
        return yield* storedCapabilities()
      }),
    )

    expect(stored).toEqual({
      queen: 'default',
      created: 'default',
      'created-again': 'default',
      fork: 'default',
      worker: 'default',
      desktop: 'default',
      unrestricted: 'default',
    })
  })

  it('keeps every list an agent definition, an access profile or a narrower creator chose', async () => {
    const narrow: readonly SessionCapability[] = ['sessions:read', 'sessions:report']
    const stored = await run(
      Effect.gen(function* () {
        // An agent definition that leaves out scheduling, before and after Scheduled tasks.
        yield* seedProfile({
          id: 'defined-old',
          capabilities: LEGACY,
          createdAt: BEFORE,
          definitionCapabilities: LEGACY,
        })
        yield* seedProfile({
          id: 'defined-full',
          capabilities: DEFAULT_SESSION_AGENT_CAPABILITIES,
          createdAt: AFTER,
          definitionCapabilities: DEFAULT_SESSION_AGENT_CAPABILITIES,
        })
        // A Session made by an access profile with the older grant.
        yield* seedProfile({
          id: 'profile-made',
          capabilities: LEGACY,
          createdAt: BEFORE,
          origin: 'profile:ci',
        })
        // A root whose creator lacked the schedule capabilities on purpose (its definition).
        yield* seedProfile({ id: 'narrowed-by-agent', capabilities: LEGACY, createdAt: AFTER })
        yield* agentCreated('narrowed-by-agent', 'defined-old')
        // The old grant written after Scheduled tasks with no default-grant source.
        yield* seedProfile({ id: 'orphan', capabilities: LEGACY, createdAt: AFTER })
        // A caller with schedules:read but not schedules:manage.
        yield* seedProfile({ id: 'read-only', capabilities: withoutManage, createdAt: AFTER })
        yield* seedProfile({ id: 'narrow', capabilities: narrow, createdAt: BEFORE })
        // The whole default copied from a Session whose definition chose it.
        yield* seedProfile({
          id: 'copied-definition',
          capabilities: DEFAULT_SESSION_AGENT_CAPABILITIES,
          createdAt: AFTER,
        })
        yield* forked('copied-definition', 'defined-full')
        // A fork of a legacy Session by an agent whose own grant was narrowed on purpose.
        yield* seedProfile({ id: 'queen', capabilities: LEGACY, createdAt: BEFORE })
        yield* seedProfile({ id: 'narrow-fork', capabilities: LEGACY, createdAt: AFTER })
        yield* forked('narrow-fork', 'queen', 'session-agent:defined-old:run-1')
        yield* agentCreated('narrow-fork', 'defined-old')
        // A root that fork's agent then created: its restriction still comes from the definition.
        yield* seedProfile({ id: 'under-narrow-fork', capabilities: LEGACY, createdAt: AFTER + 1 })
        yield* agentCreated('under-narrow-fork', 'narrow-fork')
        // The whole default a definition chose, reached through a launch and two spawns.
        yield* seedProfile({
          id: 'launched-by-definition',
          capabilities: DEFAULT_SESSION_AGENT_CAPABILITIES,
          createdAt: AFTER,
        })
        yield* agentCreated('launched-by-definition', 'defined-full')
        yield* seedProfile({
          id: 'worker-of-definition',
          capabilities: DEFAULT_SESSION_AGENT_CAPABILITIES,
          createdAt: AFTER,
        })
        yield* spawned('worker-of-definition', 'defined-full')
        yield* seedProfile({
          id: 'grandchild-of-definition',
          capabilities: DEFAULT_SESSION_AGENT_CAPABILITIES,
          createdAt: AFTER,
        })
        yield* spawned('grandchild-of-definition', 'worker-of-definition')
        // Launched before Scheduled tasks by the agent of a definition that chose the old grant.
        yield* seedProfile({ id: 'launched-old', capabilities: LEGACY, createdAt: BEFORE })
        yield* agentCreated('launched-old', 'defined-old')
        expect(yield* restoreSessionCapabilityGrants()).toBe(1)
        return yield* storedCapabilities()
      }),
    )

    expect(stored).toEqual({
      'under-narrow-fork': LEGACY,
      'launched-by-definition': DEFAULT_SESSION_AGENT_CAPABILITIES,
      'worker-of-definition': DEFAULT_SESSION_AGENT_CAPABILITIES,
      'grandchild-of-definition': DEFAULT_SESSION_AGENT_CAPABILITIES,
      'launched-old': LEGACY,
      'defined-old': LEGACY,
      'defined-full': DEFAULT_SESSION_AGENT_CAPABILITIES,
      'profile-made': LEGACY,
      'narrowed-by-agent': LEGACY,
      orphan: LEGACY,
      'read-only': withoutManage,
      narrow,
      'copied-definition': DEFAULT_SESSION_AGENT_CAPABILITIES,
      queen: 'default',
      'narrow-fork': LEGACY,
    })
  })

  it('skips a row it cannot read instead of failing on every start', async () => {
    const result = await run(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* seedProfile({ id: 'queen', capabilities: LEGACY, createdAt: BEFORE })
        yield* seedProfile({ id: 'broken', rawProfile: '{not json', createdAt: BEFORE })
        yield* seedProfile({
          id: 'broken-definition',
          capabilities: LEGACY,
          createdAt: BEFORE,
          rawDefinition: '{not json',
        })
        yield* seedProfile({
          id: 'odd-list',
          rawProfile: JSON.stringify({ sessionCapabilities: [...LEGACY, 7] }),
          createdAt: BEFORE,
        })
        const restored = yield* restoreSessionCapabilityGrants()
        const broken = yield* sql<{ readonly profile_json: string }>`
          SELECT profile_json FROM session_execution_profiles WHERE session_id = 'broken'
        `
        const capabilities = yield* sql<{ readonly session_id: string; readonly list: string }>`
          SELECT session_id, json_extract(profile_json, '$.sessionCapabilities') AS list
          FROM session_execution_profiles WHERE session_id IN ('broken-definition', 'odd-list')
          ORDER BY session_id
        `
        return { restored, broken, capabilities }
      }),
    )

    expect(result.restored).toBe(1)
    expect(result.broken).toEqual([{ profile_json: '{not json' }])
    expect(result.capabilities.map((row) => row.session_id)).toEqual([
      'broken-definition',
      'odd-list',
    ])
  })

  it('runs once, and a failure leaves the Host running and the work for the next start', async () => {
    const result = await run(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* seedProfile({ id: 'queen', capabilities: LEGACY, createdAt: BEFORE })
        expect(yield* restoreSessionCapabilityGrants()).toBe(1)
        // A list written after the marker, such as by an older binary, is left alone.
        yield* seedProfile({ id: 'later', capabilities: LEGACY, createdAt: BEFORE })
        expect(yield* restoreSessionCapabilityGrants()).toBe(0)
        const marker = yield* sql<{ readonly key: string }>`SELECT key FROM settings_store`
        yield* sql.unsafe('DROP TABLE session_spawn_lineage')
        yield* sql`DELETE FROM settings_store`
        yield* migrateLegacySessionCapabilityGrants
        const markerAfterFailure = yield* sql<{
          readonly key: string
        }>`SELECT key FROM settings_store`
        return { stored: yield* storedCapabilities(), marker, markerAfterFailure }
      }),
    )

    expect(result.marker).toEqual([{ key: SESSION_CAPABILITY_GRANTS_RESTORED_KEY }])
    expect(result.markerAfterFailure).toEqual([])
    expect(result.stored).toEqual({ queen: 'default', later: LEGACY })
  })
})
