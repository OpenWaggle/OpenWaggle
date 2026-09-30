import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import { afterEach, describe, expect, it } from 'vitest'
import { SessionLifecycleRepository } from '../../ports/session-lifecycle-repository'
import {
  makeSessionLifecycleTestLayer,
  spawnLifecycleInput,
} from './sqlite-session-lifecycle-test-support'

describe('SQLite Session lifecycle spawn from a requested Waggle', () => {
  let temporaryRoot = ''

  afterEach(async () => {
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  it('admits the spawn under the classic Run the Waggle acts for', async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-waggle-spawn-'))
    const layer = makeSessionLifecycleTestLayer(path.join(temporaryRoot, 'spawn.sqlite'))
    const input = spawnLifecycleInput()
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* SessionLifecycleRepository
        const response = yield* repository.execute({
          ...input,
          request: {
            ...input.request,
            command: { ...input.request.command, expectedParentRunId: 'waggle-of-run-parent' },
          },
        })
        const sql = yield* SqlClient.SqlClient
        const lineage = yield* sql<{ readonly parent_run_id: string }>`
          SELECT parent_run_id FROM session_spawn_lineage
          WHERE child_session_id = ${'session-worker'}
        `
        return { response, parentRunId: lineage[0]?.parent_run_id }
      }).pipe(Effect.provide(layer)),
    )

    expect(result.response.outcome).toMatchObject({ effect: 'spawned-worker' })
    expect(result.parentRunId).toBe('run-parent')
  })
})
