import type { LocalSessionCallerIdentity } from '@shared/types/local-session-profile'
import type { LocalSessionCommandPayload } from '@shared/types/local-session-protocol'
import { DEFAULT_SETTINGS } from '@shared/types/settings'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { describe, expect, it } from 'vitest'
import { SessionAuthorizationTargetRepository } from '../../ports/session-authorization-target-repository'
import { SettingsService } from '../../services/settings-service'
import { authorizeLocalSessionCommand } from '../local-session-command-dispatcher'

const targetLayer = Layer.succeed(SessionAuthorizationTargetRepository, {
  resolve: (sessionId) =>
    Effect.succeed({
      sessionId,
      projectPath: '/allowed-project',
      hiveRootSessionId: 'session-queen',
      authorizationCeiling: 'yolo',
    }),
  resolveDelegation: (delegationId) =>
    Effect.succeed({
      sessionId: `worker-for-${delegationId}`,
      projectPath: '/allowed-project',
      hiveRootSessionId: 'session-queen',
      authorizationCeiling: 'yolo',
    }),
  listLiveDerivedAuthorities: () => Effect.succeed([]),
})

const settingsLayer = Layer.succeed(SettingsService, {
  get: () => Effect.succeed(DEFAULT_SETTINGS),
  update: () => Effect.void,
  initialize: () => Effect.void,
  flushForTests: () => Effect.void,
})

const authorizationLayer = Layer.mergeAll(targetLayer, settingsLayer)

const localUser: LocalSessionCallerIdentity = { callerId: 'local-user:machine' }

function restrictedCaller(
  overrides: Partial<NonNullable<LocalSessionCallerIdentity['profileAuthority']>> = {},
): LocalSessionCallerIdentity {
  return {
    callerId: 'profile:worker-client',
    profileAuthority: {
      profileId: 'worker-client',
      profileName: 'worker-client',
      capabilities: ['sessions:start'],
      scope: { projectPaths: ['/allowed-project'] },
      authorizationCeiling: 'ask-for-approval',
      ...overrides,
    },
  }
}

function startPayload(runAuthorizationOverride: 'yolo' | 'ask-for-approval') {
  return {
    contract: 'session-control-v2',
    request: {
      contractVersion: 2,
      requestId: 'request-start',
      idempotencyKey: 'idempotency-start',
      command: {
        operation: 'start',
        sessionId: 'session-worker',
        runAuthorizationOverride,
        input: { text: 'Continue.', attachmentIds: [] },
      },
    },
  } satisfies LocalSessionCommandPayload
}

function controlPayload(
  command: Extract<
    LocalSessionCommandPayload,
    { readonly contract: 'session-control-v2' }
  >['request']['command'],
): LocalSessionCommandPayload {
  return {
    contract: 'session-control-v2',
    request: {
      contractVersion: 2,
      requestId: `request-${command.operation}`,
      idempotencyKey: `idempotency-${command.operation}`,
      command,
    },
  }
}

function queryPayload(
  query:
    | { readonly operation: 'list'; readonly limit: number; readonly projectPath?: string }
    | {
        readonly operation: 'search'
        readonly query: string
        readonly limit: number
        readonly searchScope?: 'discovery' | 'full-transcript'
      }
    | { readonly operation: 'read'; readonly sessionId: string },
): LocalSessionCommandPayload {
  return {
    contract: 'session-query-v2',
    request: { contractVersion: 2, requestId: 'request-query', query },
  }
}

describe('Local Session command authorization', () => {
  it('allows the trusted local user to request YOLO mode', async () => {
    await expect(
      Effect.runPromise(
        authorizeLocalSessionCommand({
          caller: localUser,
          payload: startPayload('yolo'),
        }).pipe(Effect.provide(authorizationLayer)),
      ),
    ).resolves.toBeUndefined()
  })

  it('rejects YOLO explicitly when the target Session ceiling is Ask for Approval', async () => {
    const askTargetLayer = Layer.mergeAll(
      settingsLayer,
      Layer.succeed(SessionAuthorizationTargetRepository, {
        resolve: (sessionId) =>
          Effect.succeed({
            sessionId,
            projectPath: '/allowed-project',
            hiveRootSessionId: 'session-queen',
            authorizationCeiling: 'ask-for-approval',
          }),
        resolveDelegation: (delegationId) =>
          Effect.succeed({
            sessionId: `worker-for-${delegationId}`,
            projectPath: '/allowed-project',
            hiveRootSessionId: 'session-queen',
            authorizationCeiling: 'ask-for-approval',
          }),
        listLiveDerivedAuthorities: () => Effect.succeed([]),
      }),
    )
    const error = await Effect.runPromise(
      authorizeLocalSessionCommand({
        caller: localUser,
        payload: startPayload('yolo'),
      })
        .pipe(Effect.flip)
        .pipe(Effect.provide(askTargetLayer)),
    )

    expect(error).toMatchObject({ code: 'authorization_ceiling_exceeded' })
  })

  it('prevents a restricted profile from exceeding its authorization ceiling', async () => {
    const error = await Effect.runPromise(
      authorizeLocalSessionCommand({
        caller: restrictedCaller(),
        payload: startPayload('yolo'),
      })
        .pipe(Effect.flip)
        .pipe(Effect.provide(authorizationLayer)),
    )

    expect(error).toMatchObject({ code: 'authorization_ceiling_exceeded' })
  })

  it.each([
    {
      operation: 'steer' as const,
      capabilities: ['sessions:steer'] as const,
      command: {
        operation: 'steer' as const,
        sessionId: 'session-worker',
        expectedRunId: 'run-active',
        input: { text: 'Run this in the active context.', attachmentIds: [] },
      },
    },
    {
      operation: 'promote' as const,
      capabilities: ['sessions:queue', 'sessions:steer'] as const,
      command: {
        operation: 'promote' as const,
        sessionId: 'session-worker',
        expectedRunId: 'run-active',
        followUpId: 'follow-up-1',
      },
    },
  ])('blocks ask-capped active-run $operation injection', async ({ capabilities, command }) => {
    const error = await Effect.runPromise(
      authorizeLocalSessionCommand({
        caller: restrictedCaller({ capabilities }),
        payload: controlPayload(command),
      })
        .pipe(Effect.flip)
        .pipe(Effect.provide(authorizationLayer)),
    )
    expect(error).toMatchObject({ code: 'authorization_ceiling_exceeded' })
  })

  it.each(['yolo', null] as const)(
    'blocks ask-capped persistent authorization %s',
    async (authorizationMode) => {
      const error = await Effect.runPromise(
        authorizeLocalSessionCommand({
          caller: restrictedCaller({ capabilities: ['sessions:authorization'] }),
          payload: controlPayload({
            operation: 'authorization-set',
            sessionId: 'session-worker',
            authorizationMode,
          }),
        })
          .pipe(Effect.flip)
          .pipe(Effect.provide(authorizationLayer)),
      )
      expect(error).toMatchObject({ code: 'authorization_ceiling_exceeded' })
    },
  )

  it('requires both the operation capability and a matching target scope', async () => {
    const missingCapability = await Effect.runPromise(
      authorizeLocalSessionCommand({
        caller: restrictedCaller({ capabilities: [] }),
        payload: startPayload('ask-for-approval'),
      })
        .pipe(Effect.flip)
        .pipe(Effect.provide(authorizationLayer)),
    )
    const wrongScope = await Effect.runPromise(
      authorizeLocalSessionCommand({
        caller: restrictedCaller({ scope: { projectPaths: ['/different-project'] } }),
        payload: startPayload('ask-for-approval'),
      })
        .pipe(Effect.flip)
        .pipe(Effect.provide(authorizationLayer)),
    )

    expect(missingCapability).toMatchObject({
      code: 'capability_denied',
      missing: ['sessions:start'],
    })
    expect(wrongScope).toMatchObject({ code: 'target_scope_denied' })
  })

  it('accepts a live non-transferable child grant outside the profile base scope', async () => {
    const caller: LocalSessionCallerIdentity = {
      callerId: 'profile:worker-client',
      baseProfileScope: { sessionIds: ['session-parent'] },
      derivedSessionAuthorities: [
        {
          sessionId: 'session-worker',
          capabilities: ['sessions:read'],
          authorizationCeiling: 'ask-for-approval',
        },
      ],
      profileAuthority: {
        profileId: 'worker-client',
        profileName: 'worker-client',
        capabilities: ['sessions:read'],
        scope: { sessionIds: ['session-parent', 'session-worker'] },
        authorizationCeiling: 'ask-for-approval',
      },
    }

    await expect(
      Effect.runPromise(
        authorizeLocalSessionCommand({
          caller,
          payload: queryPayload({ operation: 'read', sessionId: 'session-worker' }),
        }).pipe(Effect.provide(authorizationLayer)),
      ),
    ).resolves.toBeUndefined()
  })

  it('allows scoped discovery without resolving one target Session', async () => {
    await expect(
      Effect.runPromise(
        authorizeLocalSessionCommand({
          caller: restrictedCaller({ capabilities: ['sessions:discover'] }),
          payload: queryPayload({ operation: 'list', limit: 50 }),
        }).pipe(Effect.provide(authorizationLayer)),
      ),
    ).resolves.toBeUndefined()
  })

  it('denies full-transcript search to a discover-only profile', async () => {
    const error = await Effect.runPromise(
      authorizeLocalSessionCommand({
        caller: restrictedCaller({ capabilities: ['sessions:discover'] }),
        payload: queryPayload({
          operation: 'search',
          query: 'private tool marker',
          limit: 20,
          searchScope: 'full-transcript',
        }),
      })
        .pipe(Effect.flip)
        .pipe(Effect.provide(authorizationLayer)),
    )

    expect(error).toMatchObject({
      code: 'capability_denied',
      missing: ['sessions:read'],
    })
  })

  it('checks both read capability and resolved Session scope for direct reads', async () => {
    const missingCapability = await Effect.runPromise(
      authorizeLocalSessionCommand({
        caller: restrictedCaller({ capabilities: ['sessions:discover'] }),
        payload: queryPayload({ operation: 'read', sessionId: 'session-worker' }),
      })
        .pipe(Effect.flip)
        .pipe(Effect.provide(authorizationLayer)),
    )
    const wrongScope = await Effect.runPromise(
      authorizeLocalSessionCommand({
        caller: restrictedCaller({
          capabilities: ['sessions:read'],
          scope: { projectPaths: ['/different-project'] },
        }),
        payload: queryPayload({ operation: 'read', sessionId: 'session-worker' }),
      })
        .pipe(Effect.flip)
        .pipe(Effect.provide(authorizationLayer)),
    )

    expect(missingCapability).toMatchObject({
      code: 'capability_denied',
      missing: ['sessions:read'],
    })
    expect(wrongScope).toMatchObject({ code: 'target_scope_denied' })
  })
})
