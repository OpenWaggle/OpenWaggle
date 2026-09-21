import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import { SESSION_TITLE_MAX_LENGTH } from '@shared/session-title'
import * as Effect from 'effect/Effect'
import { afterEach, describe, expect, it } from 'vitest'
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

  it('normalizes and bounds a generated Worker title from its objective', async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-lifecycle-title-'))
    const layer = makeSessionLifecycleTestLayer(path.join(temporaryRoot, 'spawn.sqlite'))
    const objective = `  ${'w'.repeat(SESSION_TITLE_MAX_LENGTH + 20)}  `
    const rows = await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* SessionLifecycleRepository
        yield* repository.execute(spawnLifecycleInput(4, objective))
        const sql = yield* SqlClient.SqlClient
        return yield* sql<{ readonly title: string; readonly normalized_reference: string }>`
          SELECT sessions.title, session_report_references.normalized_reference
          FROM sessions JOIN session_report_references
            ON session_report_references.session_id = sessions.id
          WHERE sessions.id = ${'session-worker'} AND session_report_references.kind = ${'title'}
        `
      }).pipe(Effect.provide(layer)),
    )

    const expected = 'w'.repeat(SESSION_TITLE_MAX_LENGTH)
    expect(rows).toEqual([{ title: expected, normalized_reference: expected }])
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
