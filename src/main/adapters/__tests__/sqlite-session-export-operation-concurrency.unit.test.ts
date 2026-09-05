import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import type { LocalSessionProfileAuthority } from '@shared/types/local-session-profile'
import {
  SESSION_EXPORT_GLOBAL_CONCURRENCY_LIMIT,
  SESSION_EXPORT_PROFILE_CONCURRENCY_LIMIT,
} from '@shared/types/session-export-operation'
import { fromPartial } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSessionExport } from '../../application/session-export-creation'
import { SessionHostEventHub } from '../../application/session-host-event-hub'
import { SessionHostLiveness } from '../../application/session-host-liveness'
import { SessionAuthorizationTargetRepository } from '../../ports/session-authorization-target-repository'
import { SessionExportArtifactWriter } from '../../ports/session-export-artifact-writer'
import { SessionExportOperationRepository } from '../../ports/session-export-operation-repository'
import { SessionExportResourceResolver } from '../../ports/session-export-resource-resolver'
import { SessionQueryRepository } from '../../ports/session-query-repository'
import { installSessionHostEventRuntime } from '../../session-host/session-host-events'
import { SqliteSessionExportLiveAuthorityLive } from '../sqlite-session-export-live-authority'
import {
  makeSessionExportOperationRuntime,
  withSessionExportOperationRepository,
} from './sqlite-session-export-operation-test-layer'

describe('SQLite Session export concurrency', () => {
  let temporaryRoot = ''
  const runtimes: Array<ReturnType<typeof makeSessionExportOperationRuntime>> = []
  const runtimeReleases: Array<() => void> = []
  const livenessInstances: SessionHostLiveness[] = []

  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-export-concurrency-'))
  })
  afterEach(async () => {
    for (const release of runtimeReleases.splice(0)) release()
    for (const liveness of livenessInstances.splice(0)) liveness.close()
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

  it('shares one named-profile limit across exports created by two Sessions', async () => {
    const active = makeSessionExportOperationRuntime(path.join(temporaryRoot, 'agents.sqlite'))
    runtimes.push(active)
    const liveness = new SessionHostLiveness({
      idleGracePeriodMs: 60_000,
      requestShutdown: vi.fn(),
    })
    livenessInstances.push(liveness)
    runtimeReleases.push(
      installSessionHostEventRuntime({ eventHub: new SessionHostEventHub(), liveness }),
    )
    const unusedExportDependencies = Layer.mergeAll(
      Layer.succeed(SessionAuthorizationTargetRepository, fromPartial({})),
      Layer.succeed(SessionExportArtifactWriter, fromPartial({})),
      Layer.succeed(SessionExportResourceResolver, fromPartial({})),
      Layer.succeed(SessionQueryRepository, fromPartial({})),
      SqliteSessionExportLiveAuthorityLive,
    )
    const result = await active.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const repository = yield* SessionExportOperationRepository
        yield* sql`INSERT INTO sessions (id) VALUES (${'session-2'})`
        for (const sessionId of ['session-1', 'session-2']) {
          yield* sql`
            INSERT INTO session_execution_profiles (
              session_id, profile_json, authority_origin_caller_id,
              authorization_ceiling, created_at, updated_at
            ) VALUES (
              ${sessionId}, ${'{}'}, ${'profile:shared-profile'},
              ${'ask-for-approval'}, ${1}, ${1}
            )
          `
        }
        const blockers = []
        for (let index = 0; index < SESSION_EXPORT_GLOBAL_CONCURRENCY_LIMIT; index += 1) {
          const blocker = yield* repository.create({
            callerId: 'local-user',
            idempotencyKey: `blocker-${index}`,
            command: {
              operation: 'export-create',
              sessionId: 'session-1',
              format: 'jsonl',
              destinationPath: path.join(temporaryRoot, `blocker-${index}.jsonl`),
            },
            now: index + 1,
          })
          blockers.push(blocker.operation)
          yield* repository.claimExecution(blocker.operation.exportOperationId, 10 + index)
        }
        const agentAuthority = (sessionId: string): LocalSessionProfileAuthority => ({
          profileId: `session-agent:${sessionId}`,
          profileName: `session-agent:${sessionId}`,
          capabilities: ['sessions:export', 'sessions:read'],
          scope: { all: true, exportRoots: [temporaryRoot] },
          authorizationCeiling: 'ask-for-approval',
        })
        const sessionIds = ['session-1', 'session-2', 'session-1']
        const createdIds = []
        for (const [index, sessionId] of sessionIds.entries()) {
          const created = yield* createSessionExport({
            callerId: `session-agent:${sessionId}:run-${index}`,
            authority: agentAuthority(sessionId),
            request: {
              contractVersion: 2,
              requestId: `agent-export-${index}`,
              idempotencyKey: `agent-export-${index}`,
              command: {
                operation: 'export-create',
                sessionId,
                format: 'jsonl',
                destinationPath: path.join(temporaryRoot, `agent-${index}.jsonl`),
              },
            },
          })
          createdIds.push({ sessionId, operationId: created.outcome.exportOperationId })
        }
        for (const blocker of blockers) {
          yield* repository.complete(blocker.exportOperationId, blocker.progress, 20)
        }
        const claims = yield* Effect.all(
          createdIds.map(() => repository.claimNextExecution(30)),
          { concurrency: 'unbounded' },
        )
        const created = yield* Effect.all(
          createdIds.map(({ sessionId, operationId }) => repository.read(sessionId, operationId)),
        )
        return { claims, created }
      }).pipe(Effect.provide(unusedExportDependencies)),
    )

    expect(result.created).toHaveLength(3)
    expect(
      result.created.every((operation) => operation?.originProfileId === 'shared-profile'),
    ).toBe(true)
    expect(result.claims.filter((claim) => claim.status === 'claimed')).toHaveLength(
      SESSION_EXPORT_PROFILE_CONCURRENCY_LIMIT,
    )
    expect(result.claims.filter((claim) => claim.status === 'not-claimable')).toHaveLength(1)
  })
})
