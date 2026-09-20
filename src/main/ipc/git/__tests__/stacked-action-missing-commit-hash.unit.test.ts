import { SessionId } from '@shared/types/brand'
import type { GitRunStackedActionResult } from '@shared/types/git'
import { fromPartial } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { describe, expect, it, vi } from 'vitest'
import { sessionResourceTestLayer } from '../../../application/__tests__/session-resource-capture.fixtures'
import {
  SessionOutputRetryRepository,
  type SessionOutputRetryRepositoryShape,
} from '../../../ports/session-output-retry-repository'
import { SessionRepository, type SessionRepositoryShape } from '../../../ports/session-repository'
import { recordStackedActionOutputs } from '../stacked-action-output-recording'
import { runStackedGitAction } from '../stacked-action-service'
import { makeDeps } from './stacked-action-service.test-harness'

const UNUSED_REPOSITORIES = Layer.mergeAll(
  sessionResourceTestLayer([]),
  Layer.succeed(
    SessionOutputRetryRepository,
    SessionOutputRetryRepository.of(fromPartial<SessionOutputRetryRepositoryShape>({})),
  ),
  Layer.succeed(SessionRepository, SessionRepository.of(fromPartial<SessionRepositoryShape>({}))),
)

describe('stacked action missing commit identity', () => {
  it('continues after the successful commit and promotes its Output warning', async () => {
    const warning = { ok: false as const, retryPersisted: false, message: 'Hash unavailable.' }
    const deps = makeDeps({
      commit: vi.fn(async () => ({
        ok: true as const,
        commitHash: null,
        summary: 'Committed',
        commitOutput: warning,
      })),
    })

    const result = await runStackedGitAction(deps, '/repo', {
      action: 'commit_push',
      commitMessage: 'Committed',
      paths: ['src/app.ts'],
    })

    expect(result).toMatchObject({
      ok: true,
      commit: { commitHash: null },
      commitOutput: warning,
    })
    expect(deps.push).toHaveBeenCalledOnce()
  })

  it('does not persist a colliding Output when the committed hash is unavailable', async () => {
    const warning = { ok: false as const, retryPersisted: false, message: 'Hash unavailable.' }
    const result: GitRunStackedActionResult = {
      ok: true,
      action: 'commit',
      branch: { status: 'unchanged', name: null },
      commit: { commitHash: null, summary: 'Committed', commitOutput: warning },
      changeRequest: null,
    }

    const recorded = await Effect.runPromise(
      recordStackedActionOutputs(result, SessionId('originating-session'), {
        nodeId: null,
        branchId: null,
        createdAt: 1000,
      }).pipe(Effect.provide(UNUSED_REPOSITORIES)),
    )

    expect(recorded).toMatchObject({ ok: true, commitOutput: warning })
  })
})
