import type { LocalSessionCallerIdentity } from '@shared/types/local-session-profile'
import type { LocalSessionCommandPayload } from '@shared/types/local-session-protocol'
import { DEFAULT_SETTINGS } from '@shared/types/settings'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { describe, expect, it, vi } from 'vitest'
import { SessionAuthorizationTargetRepository } from '../../ports/session-authorization-target-repository'
import {
  SessionControlAttachmentService,
  type SessionControlAttachmentServiceShape,
} from '../../ports/session-control-attachment-service'
import { SettingsService } from '../../services/settings-service'
import { acquirePreparedLocalSessionMutation } from '../local-session-admitted-mutation'

const PROJECT_PATH = '/workspace/project'
const SESSION_ID = 'worker-session'
const ATTACHMENT_PATH = '/workspace/granted/evidence.txt'

type ControlPayload = Extract<
  LocalSessionCommandPayload,
  { readonly contract: 'session-control-v2' }
>
type LifecyclePayload = Extract<
  LocalSessionCommandPayload,
  { readonly contract: 'session-lifecycle-v2' }
>

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function caller(attachmentRoots: readonly string[] | undefined): LocalSessionCallerIdentity {
  const scope = {
    sessionIds: [SESSION_ID],
    ...(attachmentRoots ? { attachmentRoots } : {}),
  }
  return {
    callerId: 'session-agent:queen:run-1',
    workingDirectory: PROJECT_PATH,
    baseProfileScope: scope,
    profileAuthority: {
      profileId: 'origin-profile',
      profileName: 'origin-profile',
      capabilities: ['sessions:message', 'sessions:spawn'],
      scope,
      authorizationCeiling: 'ask-for-approval',
    },
  }
}

function controlPayload(): ControlPayload {
  return {
    contract: 'session-control-v2',
    request: {
      contractVersion: 2,
      requestId: 'message-request',
      idempotencyKey: 'message-once',
      command: {
        operation: 'message',
        sessionId: SESSION_ID,
        input: { text: 'Review this evidence.', attachmentIds: [] },
      },
    },
    transport: { attachmentPaths: [ATTACHMENT_PATH] },
  }
}

function lifecyclePayload(): LifecyclePayload {
  return {
    contract: 'session-lifecycle-v2',
    request: {
      contractVersion: 2,
      requestId: 'spawn-request',
      idempotencyKey: 'spawn-once',
      command: {
        operation: 'spawn',
        parentSessionId: SESSION_ID,
        expectedParentRunId: 'parent-run',
        workspace: { mode: 'share-parent' },
        attachmentIds: [],
        delegation: {
          objective: 'Review this evidence.',
          deliverables: [],
          acceptanceCriteria: [],
          dependencies: [],
          resourceReferences: [],
        },
      },
    },
    transport: { attachmentPaths: [ATTACHMENT_PATH] },
  }
}

function testLayer(prepare: SessionControlAttachmentServiceShape['prepare']) {
  return Layer.mergeAll(
    Layer.succeed(SessionAuthorizationTargetRepository, {
      resolve: (sessionId) =>
        Effect.succeed({
          sessionId,
          projectPath: PROJECT_PATH,
          workingPath: PROJECT_PATH,
          hiveRootSessionId: SESSION_ID,
          authorizationCeiling: 'ask-for-approval' as const,
        }),
      resolveDelegation: () => Effect.die('Delegations are not used in this test.'),
      listLiveDerivedAuthorities: () => Effect.succeed([]),
    }),
    Layer.succeed(SessionControlAttachmentService, {
      prepare,
      bind: () => Effect.die('A downgraded attachment must not be bound.'),
      resolve: () => Effect.die('A downgraded attachment must not be resolved.'),
      release: () => Effect.die('A downgraded attachment must not be released.'),
      cleanupUnreferenced: () => Effect.die('A downgraded attachment must not be cleaned.'),
    }),
    Layer.succeed(SettingsService, {
      get: () => Effect.succeed(DEFAULT_SETTINGS),
      update: () => Effect.void,
      initialize: () => Effect.void,
      flushForTests: () => Effect.void,
    }),
  )
}

function raceHarness() {
  const firstBoundary = deferred<'admission' | 'preparation'>()
  const downgradePersisted = deferred<void>()
  const release = vi.fn()
  const prepare = vi.fn(() => {
    firstBoundary.resolve('preparation')
    return Effect.succeed([])
  })
  const mutationAdmission = vi.fn(async () => {
    firstBoundary.resolve('admission')
    await downgradePersisted.promise
    return { caller: caller(undefined), release }
  })
  return { firstBoundary, downgradePersisted, release, prepare, mutationAdmission }
}

async function expectDowngradeRejected(
  running: Promise<unknown>,
  harness: ReturnType<typeof raceHarness>,
) {
  await expect(harness.firstBoundary.promise).resolves.toBe('admission')
  expect(harness.prepare).not.toHaveBeenCalled()
  harness.downgradePersisted.resolve(undefined)
  await expect(running).rejects.toThrow('attachment-root grant')
  expect(harness.prepare).not.toHaveBeenCalled()
  expect(harness.release).toHaveBeenCalledOnce()
}

describe('Pi-native Session attachment profile fencing', () => {
  it('holds control attachment preparation behind a persisted root downgrade', async () => {
    const harness = raceHarness()
    const running = Effect.runPromise(
      acquirePreparedLocalSessionMutation({
        caller: caller(['/workspace/granted']),
        payload: controlPayload(),
        mutationAdmission: harness.mutationAdmission,
      }).pipe(Effect.provide(testLayer(harness.prepare))),
    )
    await expectDowngradeRejected(running, harness)
  })

  it('holds lifecycle attachment preparation behind a persisted root downgrade', async () => {
    const harness = raceHarness()
    const running = Effect.runPromise(
      acquirePreparedLocalSessionMutation({
        caller: caller(['/workspace/granted']),
        payload: lifecyclePayload(),
        mutationAdmission: harness.mutationAdmission,
      }).pipe(Effect.provide(testLayer(harness.prepare))),
    )
    await expectDowngradeRejected(running, harness)
  })
})
