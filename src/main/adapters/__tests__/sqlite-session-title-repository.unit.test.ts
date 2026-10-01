import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import { SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { afterEach, describe, expect, it } from 'vitest'
import { SessionLifecycleRepository } from '../../ports/session-lifecycle-repository'
import { SessionTitleRepository } from '../../ports/session-title-repository'
import { SqliteSessionTitleRepositoryLive } from '../sqlite-session-title-repository'
import {
  makeSessionLifecycleTestLayer,
  rootLifecycleInput,
  spawnLifecycleInput,
} from './sqlite-session-lifecycle-test-support'

const ROOT = SessionId('session-create')
const WORKER = SessionId('session-worker')

describe('SQLite Session title repository', () => {
  let temporaryRoot = ''

  afterEach(async () => {
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  async function withRepository<A>(
    program: Effect.Effect<
      A,
      unknown,
      SessionTitleRepository | SessionLifecycleRepository | SqlClient.SqlClient
    >,
  ) {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-title-repository-'))
    const base = makeSessionLifecycleTestLayer(path.join(temporaryRoot, 'titles.sqlite'))
    const layer = Layer.merge(base, SqliteSessionTitleRepositoryLive.pipe(Layer.provide(base)))
    return Effect.runPromise(program.pipe(Effect.provide(layer)))
  }

  function createUntitledRoot() {
    return Effect.gen(function* () {
      const created = rootLifecycleInput('create')
      const { title: _title, ...command } = created.request.command
      yield* (yield* SessionLifecycleRepository).execute({
        ...created,
        request: { ...created.request, command },
      })
    })
  }

  function titleRow(sessionId: SessionId) {
    return Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const rows = yield* sql<{
        readonly title: string
        readonly title_source: string
        readonly title_needs_refinement: number
        readonly updated_at: number
        readonly reference: string | null
      }>`
        SELECT sessions.title, sessions.title_source, sessions.title_needs_refinement,
          sessions.updated_at, session_report_references.normalized_reference AS reference
        FROM sessions LEFT JOIN session_report_references
          ON session_report_references.session_id = sessions.id
          AND session_report_references.kind = ${'title'}
        WHERE sessions.id = ${sessionId}
      `
      return rows[0]
    })
  }

  it('reads the state generation needs, including Worker lineage and the execution model', async () => {
    const states = await withRepository(
      Effect.gen(function* () {
        yield* createUntitledRoot()
        yield* (yield* SessionLifecycleRepository).execute(
          spawnLifecycleInput(4, 'Review the auth module'),
        )
        const repository = yield* SessionTitleRepository
        return [yield* repository.getState(ROOT), yield* repository.getState(WORKER)]
      }),
    )

    expect(states[0]).toMatchObject({
      title: 'New session',
      source: 'default',
      needsRefinement: false,
      isWorker: false,
      executionModel: 'provider/model',
    })
    expect(states[1]).toMatchObject({
      title: 'Review the auth module',
      source: 'provisional',
      isWorker: true,
    })
  })

  it('writes the Provisional title only over the default one, without touching recency', async () => {
    const result = await withRepository(
      Effect.gen(function* () {
        yield* createUntitledRoot()
        const repository = yield* SessionTitleRepository
        const before = yield* titleRow(ROOT)
        const first = yield* repository.assignProvisional(ROOT, 'Hello world')
        const second = yield* repository.assignProvisional(ROOT, 'Another message')
        return { before, first, second, after: yield* titleRow(ROOT) }
      }),
    )

    expect(result.first).toBe(true)
    expect(result.second).toBe(false)
    expect(result.after).toMatchObject({
      title: 'Hello world',
      title_source: 'provisional',
      reference: 'hello world',
      updated_at: result.before?.updated_at,
    })
  })

  it('applies a generated title only while the expected title and source still hold', async () => {
    const result = await withRepository(
      Effect.gen(function* () {
        yield* createUntitledRoot()
        const repository = yield* SessionTitleRepository
        yield* repository.assignProvisional(ROOT, 'fix this')
        const stale = yield* repository.applyGenerated({
          sessionId: ROOT,
          expected: { title: 'something else', sources: ['provisional'] },
          title: 'Wrong',
          needsRefinement: false,
        })
        const applied = yield* repository.applyGenerated({
          sessionId: ROOT,
          expected: { title: 'fix this', sources: ['default', 'provisional'] },
          title: 'Fix failing test',
          needsRefinement: true,
        })
        const pending = yield* repository.listPendingRefinements(10)
        yield* repository.clearRefinement(ROOT)
        return {
          stale,
          applied,
          pending,
          afterClear: yield* repository.listPendingRefinements(10),
          row: yield* titleRow(ROOT),
        }
      }),
    )

    expect(result.stale).toBe(false)
    expect(result.applied).toBe(true)
    expect(result.pending).toEqual([ROOT])
    expect(result.afterClear).toEqual([])
    expect(result.row).toMatchObject({
      title: 'Fix failing test',
      title_source: 'generated',
      title_needs_refinement: 0,
      reference: 'fix failing test',
    })
  })

  it('never lets generation replace a manual title', async () => {
    const applied = await withRepository(
      Effect.gen(function* () {
        yield* (yield* SessionLifecycleRepository).execute(rootLifecycleInput('create'))
        return yield* (yield* SessionTitleRepository).applyGenerated({
          sessionId: ROOT,
          expected: { title: 'Idle root', sources: ['default', 'provisional'] },
          title: 'Generated',
          needsRefinement: false,
        })
      }),
    )

    expect(applied).toBe(false)
  })
})
