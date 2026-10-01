import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import { SESSION_TITLE_MAX_LENGTH } from '@shared/session-title'
import * as Effect from 'effect/Effect'
import { afterEach, describe, expect, it } from 'vitest'
import { buildDeterministicTitle } from '../../agent/title-generator'
import { SessionLifecycleRepository } from '../../ports/session-lifecycle-repository'
import {
  makeSessionLifecycleTestLayer,
  rootLifecycleInput,
  spawnLifecycleInput,
} from './sqlite-session-lifecycle-test-support'

describe('SQLite Session lifecycle title persistence', () => {
  let temporaryRoot = ''

  afterEach(async () => {
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  it('starts a Worker with a Provisional title trimmed from its objective', async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-lifecycle-title-'))
    const layer = makeSessionLifecycleTestLayer(path.join(temporaryRoot, 'spawn.sqlite'))
    const objective = `  Review the authentication module\n\nfor ${'token '.repeat(200)}  `
    const rows = await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* SessionLifecycleRepository
        yield* repository.execute(spawnLifecycleInput(4, objective))
        const sql = yield* SqlClient.SqlClient
        return yield* sql<{
          readonly title: string
          readonly title_source: string
          readonly normalized_reference: string
        }>`
          SELECT sessions.title, sessions.title_source, session_report_references.normalized_reference
          FROM sessions JOIN session_report_references
            ON session_report_references.session_id = sessions.id
          WHERE sessions.id = ${'session-worker'} AND session_report_references.kind = ${'title'}
        `
      }).pipe(Effect.provide(layer)),
    )

    const expected = buildDeterministicTitle(objective)
    expect(expected.length).toBeLessThan(SESSION_TITLE_MAX_LENGTH)
    expect(rows).toEqual([
      {
        title: expected,
        title_source: 'provisional',
        normalized_reference: expected.toLowerCase(),
      },
    ])
  })

  it('records an explicit title as manual and an untitled root as default', async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-lifecycle-title-'))
    const layer = makeSessionLifecycleTestLayer(path.join(temporaryRoot, 'sources.sqlite'))
    const created = rootLifecycleInput('create')
    const { title: _title, ...untitledCommand } = created.request.command
    const rows = await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* SessionLifecycleRepository
        yield* repository.execute({
          ...created,
          request: { ...created.request, command: untitledCommand },
        })
        yield* repository.execute(rootLifecycleInput('launch'))
        const sql = yield* SqlClient.SqlClient
        return yield* sql<{ readonly title: string; readonly title_source: string }>`
          SELECT title, title_source FROM sessions ORDER BY title
        `
      }).pipe(Effect.provide(layer)),
    )

    expect(rows).toEqual(
      expect.arrayContaining([
        { title: 'Running root', title_source: 'manual' },
        { title: 'New session', title_source: 'default' },
      ]),
    )
  })

  it('starts an untitled launched root with a Provisional title from its objective', async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-lifecycle-title-'))
    const layer = makeSessionLifecycleTestLayer(path.join(temporaryRoot, 'launch.sqlite'))
    const launched = rootLifecycleInput('launch')
    const { title: _title, ...untitled } = launched.request.command
    const rows = await Effect.runPromise(
      Effect.gen(function* () {
        yield* (yield* SessionLifecycleRepository).execute({
          ...launched,
          request: { ...launched.request, command: untitled },
        })
        const sql = yield* SqlClient.SqlClient
        return yield* sql<{ readonly title: string; readonly title_source: string }>`
          SELECT title, title_source FROM sessions WHERE id = ${'session-launch'}
        `
      }).pipe(Effect.provide(layer)),
    )

    expect(rows).toEqual([{ title: 'Audit the target schema.', title_source: 'provisional' }])
  })

  it('rejects a blank explicit title when an internal caller bypasses boundary decoding', async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-lifecycle-title-'))
    const layer = makeSessionLifecycleTestLayer(path.join(temporaryRoot, 'blank.sqlite'))
    const input = rootLifecycleInput('create')

    await expect(
      Effect.runPromise(
        Effect.flatMap(SessionLifecycleRepository, (repository) =>
          repository.execute({
            ...input,
            request: {
              ...input.request,
              command: { ...input.request.command, title: '' },
            },
          }),
        ).pipe(Effect.provide(layer)),
      ),
    ).rejects.toThrow('Session title cannot be blank.')
  })
})
