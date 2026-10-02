import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import { SqliteClient } from '@effect/sql-sqlite-node'
import type { ThinkingLevel } from '@shared/types/settings'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ThinkingLevelDefaultService } from '../../ports/thinking-level-default-service'
import { SQLITE_PREPARE_CACHE_SIZE } from '../../services/database-constants'
import { migrateLegacyThinkingLevels } from '../sqlite-legacy-thinking-level-migration'

let tmpRoot = ''

/** Pi's global settings, in memory: `configured` is what they name as `defaultThinkingLevel`. */
function piDefaults(initial: ThinkingLevel | undefined) {
  let configured = initial
  const setDefault = vi.fn(
    (level: ThinkingLevel): Effect.Effect<void, Error> =>
      Effect.sync(() => {
        configured = level
      }),
  )
  return {
    setDefault,
    configured: () => configured,
    layer: Layer.succeed(ThinkingLevelDefaultService, {
      getDefault: () => Effect.sync(() => configured ?? 'medium'),
      getConfiguredDefault: () => Effect.sync(() => configured),
      setDefault,
    }),
  }
}

function databaseLayer(name: string) {
  const sqlite = SqliteClient.layer({
    filename: path.join(tmpRoot, name),
    prepareCacheSize: SQLITE_PREPARE_CACHE_SIZE,
  })
  const schema = Layer.effectDiscard(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql.unsafe(`CREATE TABLE settings_store (
        key TEXT PRIMARY KEY, value_json TEXT NOT NULL, updated_at INTEGER NOT NULL
      )`)
      yield* sql.unsafe(`CREATE TABLE sessions (id TEXT PRIMARY KEY, last_active_node_id TEXT)`)
      yield* sql.unsafe(`CREATE TABLE session_nodes (
        id TEXT PRIMARY KEY, session_id TEXT NOT NULL, parent_id TEXT, kind TEXT NOT NULL,
        content_json TEXT NOT NULL, path_depth INTEGER NOT NULL, created_order INTEGER NOT NULL
      )`)
      yield* sql.unsafe(`CREATE TABLE session_execution_profiles (
        session_id TEXT PRIMARY KEY, profile_json TEXT NOT NULL, updated_at INTEGER NOT NULL
      )`)
    }).pipe(Effect.provide(sqlite)),
  )
  return Layer.merge(sqlite, schema)
}

interface NodeSeed {
  readonly id: string
  readonly parentId: string | null
  readonly thinkingLevel?: ThinkingLevel
}

function seedSession(input: {
  readonly id: string
  readonly profile: Record<string, string>
  readonly lastActiveNodeId?: string
  readonly nodes?: readonly NodeSeed[]
}) {
  return Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    yield* sql`
      INSERT INTO sessions (id, last_active_node_id)
      VALUES (${input.id}, ${input.lastActiveNodeId ?? null})
    `
    yield* sql`
      INSERT INTO session_execution_profiles (session_id, profile_json, updated_at)
      VALUES (${input.id}, ${JSON.stringify(input.profile)}, ${1})
    `
    const depths = new Map<string, number>()
    for (const [order, node] of (input.nodes ?? []).entries()) {
      const depth = node.parentId === null ? 0 : (depths.get(node.parentId) ?? 0) + 1
      depths.set(node.id, depth)
      yield* sql`
        INSERT INTO session_nodes (
          id, session_id, parent_id, kind, content_json, path_depth, created_order
        ) VALUES (
          ${node.id}, ${input.id}, ${node.parentId},
          ${node.thinkingLevel ? 'thinking_level_change' : 'message'},
          ${JSON.stringify(node.thinkingLevel ? { thinkingLevel: node.thinkingLevel } : {})},
          ${depth}, ${order}
        )
      `
    }
  })
}

function storedLevels() {
  return Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const rows = yield* sql<{ readonly session_id: string; readonly level: string | null }>`
      SELECT session_id, json_extract(profile_json, '$.thinkingLevel') AS level
      FROM session_execution_profiles ORDER BY session_id
    `
    return Object.fromEntries(rows.map((row) => [row.session_id, row.level]))
  })
}

function settingKeys() {
  return Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const rows = yield* sql<{ readonly key: string }>`SELECT key FROM settings_store ORDER BY key`
    return rows.map((row) => row.key)
  })
}

function legacyPick(level: string) {
  return SqlClient.SqlClient.pipe(
    Effect.flatMap(
      (sql) =>
        sql`
          INSERT INTO settings_store (key, value_json, updated_at)
          VALUES (${'thinkingLevel'}, ${JSON.stringify(level)}, ${1})
        `,
    ),
  )
}

describe('legacy thinking level migration', () => {
  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-legacy-thinking-'))
  })

  afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true })
  })

  it("moves beta.5's desktop pick into Pi's default once and deletes it", async () => {
    const pi = piDefaults(undefined)
    const keys = await Effect.runPromise(
      Effect.gen(function* () {
        yield* legacyPick('high')
        yield* migrateLegacyThinkingLevels
        const afterFirst = yield* settingKeys()
        // A second start finds nothing left to move.
        yield* migrateLegacyThinkingLevels
        return afterFirst
      }).pipe(Effect.provide(Layer.merge(databaseLayer('pick.sqlite'), pi.layer))),
    )

    expect(pi.configured()).toBe('high')
    expect(pi.setDefault).toHaveBeenCalledOnce()
    expect(keys).toEqual(['sessionThinkingLevelsRestored'])
  })

  it.each([
    ['Pi already names a default', 'low' as const, 'high', 'low'],
    ['the stored pick is not a level', undefined, 'ultra', undefined],
  ])('deletes the desktop pick without writing it when %s', async (_case, initial, pick, after) => {
    const pi = piDefaults(initial)
    const keys = await Effect.runPromise(
      Effect.gen(function* () {
        yield* legacyPick(pick)
        yield* migrateLegacyThinkingLevels
        return yield* settingKeys()
      }).pipe(Effect.provide(Layer.merge(databaseLayer('kept.sqlite'), pi.layer))),
    )

    expect(pi.setDefault).not.toHaveBeenCalled()
    expect(pi.configured()).toBe(after)
    expect(keys).not.toContain('thinkingLevel')
  })

  it("keeps the desktop pick for the next start when writing Pi's default fails", async () => {
    const pi = piDefaults(undefined)
    pi.setDefault.mockImplementation(() => Effect.fail(new Error('settings.json is read-only')))
    const keys = await Effect.runPromise(
      Effect.gen(function* () {
        yield* legacyPick('high')
        yield* migrateLegacyThinkingLevels
        return yield* settingKeys()
      }).pipe(Effect.provide(Layer.merge(databaseLayer('retry.sqlite'), pi.layer))),
    )

    expect(keys).toEqual(['thinkingLevel'])
  })

  it('stores the level each Session runs with: its last entry on the active path', async () => {
    const pi = piDefaults(undefined)
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        yield* legacyPick('xhigh')
        // Ran at high, then low on a branch the user left; the active branch's last is high.
        yield* seedSession({
          id: 'session-branched',
          profile: { modelId: 'provider/model', thinkingLevel: 'medium' },
          lastActiveNodeId: 'active-leaf',
          nodes: [
            { id: 'root', parentId: null },
            { id: 'first-change', parentId: 'root', thinkingLevel: 'minimal' },
            { id: 'second-change', parentId: 'first-change', thinkingLevel: 'high' },
            { id: 'active-leaf', parentId: 'second-change' },
            { id: 'abandoned-change', parentId: 'first-change', thinkingLevel: 'low' },
          ],
        })
        // No active node recorded: Pi opens at the newest entry.
        yield* seedSession({
          id: 'session-unpositioned',
          profile: { modelId: 'provider/model', thinkingLevel: 'medium' },
          nodes: [
            { id: 'u-root', parentId: null },
            { id: 'u-change', parentId: 'u-root', thinkingLevel: 'minimal' },
          ],
        })
        // Never ran: its stored level is what its first Run will use.
        yield* seedSession({
          id: 'session-unused',
          profile: { modelId: 'provider/model', thinkingLevel: 'low' },
        })
        // No usable stored level and no entries: what the UI showed, Pi's default.
        yield* seedSession({ id: 'session-unset', profile: { modelId: 'provider/model' } })
        yield* migrateLegacyThinkingLevels
        const first = yield* storedLevels()
        // Once: a later change the user makes is never overwritten by a later start.
        const sql = yield* SqlClient.SqlClient
        yield* sql`
          UPDATE session_execution_profiles
          SET profile_json = json_set(profile_json, '$.thinkingLevel', 'max')
          WHERE session_id = ${'session-branched'}
        `
        yield* migrateLegacyThinkingLevels
        return { first, second: yield* storedLevels() }
      }).pipe(Effect.provide(Layer.merge(databaseLayer('sessions.sqlite'), pi.layer))),
    )

    expect(result.first).toEqual({
      'session-branched': 'high',
      'session-unpositioned': 'minimal',
      'session-unused': 'low',
      'session-unset': 'xhigh',
    })
    expect(result.second['session-branched']).toBe('max')
  })

  /** Seeds one Session whose last entry on its active path records `restored`. */
  function sessionRestoring(id: string, restored: ThinkingLevel, stored?: ThinkingLevel) {
    return seedSession({
      id,
      profile: { modelId: 'provider/model', ...(stored ? { thinkingLevel: stored } : {}) },
      nodes: [
        { id: `${id}-root`, parentId: null },
        { id: `${id}-change`, parentId: `${id}-root`, thinkingLevel: restored },
      ],
    })
  }

  it.each([
    ['the desktop pick', 'high', 'medium', 'high'],
    ['the stored level when there is no desktop pick', undefined, 'medium', 'medium'],
    ['off when the desktop pick was off', 'off', 'medium', 'off'],
    ['off when no legacy level is higher', undefined, 'off', 'off'],
  ] as const)(
    'turns a restored off, which Pi records after clamping to the model, into %s',
    async (_case, pick, stored, expected) => {
      const pi = piDefaults('low')
      const levels = await Effect.runPromise(
        Effect.gen(function* () {
          if (pick) yield* legacyPick(pick)
          yield* sessionRestoring('session-clamped', 'off', stored)
          yield* migrateLegacyThinkingLevels
          return yield* storedLevels()
        }).pipe(Effect.provide(Layer.merge(databaseLayer('clamped.sqlite'), pi.layer))),
      )

      expect(levels['session-clamped']).toBe(expected)
    },
  )

  it('keeps a restored level above off even when the legacy level is higher', async () => {
    const pi = piDefaults(undefined)
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        yield* legacyPick('max')
        yield* sessionRestoring('session-low', 'low', 'high')
        yield* migrateLegacyThinkingLevels
        return { levels: yield* storedLevels(), keys: yield* settingKeys() }
      }).pipe(Effect.provide(Layer.merge(databaseLayer('above-off.sqlite'), pi.layer))),
    )

    expect(result.levels['session-low']).toBe('low')
    // The desktop pick is deleted only after the Sessions were restored with it.
    expect(result.keys).toEqual(['sessionThinkingLevelsRestored'])
  })
})
