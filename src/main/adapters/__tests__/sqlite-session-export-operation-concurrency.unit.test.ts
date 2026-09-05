import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  SESSION_EXPORT_GLOBAL_CONCURRENCY_LIMIT,
  SESSION_EXPORT_PROFILE_CONCURRENCY_LIMIT,
} from '@shared/types/session-export-operation'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  makeSessionExportOperationRuntime,
  withSessionExportOperationRepository,
} from './sqlite-session-export-operation-test-layer'

describe('SQLite Session export concurrency', () => {
  let temporaryRoot = ''
  const runtimes: Array<ReturnType<typeof makeSessionExportOperationRuntime>> = []

  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-export-concurrency-'))
  })
  afterEach(async () => {
    await Promise.all(runtimes.splice(0).map((runtime) => runtime.dispose()))
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  it('keeps excess exports queued under global and per-profile limits', async () => {
    const active = makeSessionExportOperationRuntime(path.join(temporaryRoot, 'exports.sqlite'))
    runtimes.push(active)
    const result = await withSessionExportOperationRepository(active, (repository) =>
      Effect.gen(function* () {
        const profiles = ['profile-a', 'profile-a', 'profile-a', 'profile-b', 'profile-b']
        const created = []
        for (const [index, originProfileId] of profiles.entries()) {
          created.push(
            yield* repository.create({
              callerId: `profile:${originProfileId}`,
              originProfileId,
              idempotencyKey: `bounded-export-${index}`,
              command: {
                operation: 'export-create',
                sessionId: 'session-1',
                format: 'jsonl',
                destinationPath: path.join(temporaryRoot, `bounded-${index}.jsonl`),
              },
              now: index + 1,
            }),
          )
        }
        const claims = yield* Effect.all(
          profiles.map((_profile, index) => repository.claimNextExecution(10 + index)),
          { concurrency: 'unbounded' },
        )
        const queued = yield* repository.read(
          'session-1',
          created[2]?.operation.exportOperationId ?? '',
        )
        const profileAClaim = claims.find(
          (claim) => claim.status === 'claimed' && claim.operation.originProfileId === 'profile-a',
        )
        if (profileAClaim?.status !== 'claimed') {
          return yield* Effect.die('Expected a profile A export to be claimed.')
        }
        yield* repository.complete(
          profileAClaim.operation.exportOperationId,
          { recordsWritten: 0, resourcesWritten: 0, bytesWritten: 0 },
          21,
        )
        return { claims, queued, resumed: yield* repository.claimNextExecution(22) }
      }),
    )

    expect(result.claims.filter((claim) => claim.status === 'claimed')).toHaveLength(
      SESSION_EXPORT_GLOBAL_CONCURRENCY_LIMIT,
    )
    for (const profile of ['profile-a', 'profile-b']) {
      expect(
        result.claims.filter(
          (claim) => claim.status === 'claimed' && claim.operation.originProfileId === profile,
        ),
      ).toHaveLength(SESSION_EXPORT_PROFILE_CONCURRENCY_LIMIT)
    }
    expect(result.claims.filter((claim) => claim.status === 'not-claimable')).toHaveLength(1)
    expect(result.queued).toMatchObject({ status: 'queued', originProfileId: 'profile-a' })
    expect(result.resumed).toMatchObject({
      status: 'claimed',
      operation: { originProfileId: 'profile-a' },
    })
  })
})
