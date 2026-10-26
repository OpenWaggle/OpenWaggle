import type {
  LocalSessionCallerIdentity,
  LocalSessionProfileAuthority,
} from '@shared/types/local-session-profile'
import * as Effect from 'effect/Effect'
import { describe, expect, it } from 'vitest'
import { authorizeSessionTargetForCaller } from '../../domain/session-control/session-capability-authorization'
import { LocalSessionCommandAuthorizationError } from '../../errors'
import { narrowNamedProfileCaller } from '../local-session-profile-narrowing'
import { repositoryLayer, SESSIONS } from './local-session-profile-narrowing.test-support'

function profileCaller(
  authority: Omit<LocalSessionProfileAuthority, 'profileId' | 'profileName'>,
  narrowing: Omit<LocalSessionProfileAuthority, 'profileId' | 'profileName'>,
  extra: Partial<LocalSessionCallerIdentity> = {},
): LocalSessionCallerIdentity {
  return {
    callerId: 'profile:reviewer-id',
    baseProfileScope: authority.scope,
    profileAuthority: { profileId: 'reviewer-id', profileName: 'reviewer', ...authority },
    profileNarrowing: { profileId: 'mcp:reviewer', profileName: 'reviewer', ...narrowing },
    ...extra,
  }
}

function narrow(caller: LocalSessionCallerIdentity) {
  return Effect.runPromise(narrowNamedProfileCaller(caller).pipe(Effect.provide(repositoryLayer)))
}

function failure(caller: LocalSessionCallerIdentity) {
  return Effect.runPromise(
    narrowNamedProfileCaller(caller).pipe(Effect.flip, Effect.provide(repositoryLayer)),
  )
}

describe('narrowNamedProfileCaller', () => {
  it('leaves a caller without MCP narrowing untouched', async () => {
    const caller: LocalSessionCallerIdentity = {
      callerId: 'profile:reviewer-id',
      profileAuthority: {
        profileId: 'reviewer-id',
        profileName: 'reviewer',
        capabilities: ['sessions:discover'],
        scope: { all: true },
        authorizationCeiling: 'yolo',
      },
    }

    await expect(narrow(caller)).resolves.toBe(caller)
  })

  it('keeps only the capabilities, projects, and Sessions both the profile and the server grant', async () => {
    const narrowed = await narrow(
      profileCaller(
        {
          capabilities: ['sessions:discover', 'sessions:read'],
          scope: { projectPaths: ['/repo-a', '/repo-b'], sessionIds: ['c-root'] },
          authorizationCeiling: 'ask-for-approval',
        },
        {
          capabilities: ['sessions:discover', 'sessions:message'],
          scope: { workspaceRoots: ['/repo-a'], sessionIds: ['c-root'] },
          authorizationCeiling: 'yolo',
        },
      ),
    )

    expect(narrowed.profileAuthority).toEqual({
      profileId: 'reviewer-id',
      profileName: 'reviewer',
      capabilities: ['sessions:discover'],
      scope: { projectPaths: ['/repo-a'], sessionIds: ['a-root', 'a-worker', 'c-root'] },
      authorizationCeiling: 'ask-for-approval',
    })
    expect(narrowed.baseProfileScope).toEqual(narrowed.profileAuthority?.scope)
    const target = { projectPath: '/repo-b', sessionId: 'b-root', hiveRootSessionId: 'b-root' }
    expect(authorizeSessionTargetForCaller(narrowed, target, ['sessions:discover'])).toMatchObject({
      authorized: false,
      code: 'target_scope_denied',
    })
  })

  it('reaches nothing when the server scope is outside the profile', async () => {
    const narrowed = await narrow(
      profileCaller(
        {
          capabilities: ['sessions:discover'],
          scope: { projectPaths: ['/repo-a'] },
          authorizationCeiling: 'ask-for-approval',
        },
        {
          capabilities: ['sessions:discover'],
          scope: { workspaceRoots: ['/repo-b'] },
          authorizationCeiling: 'ask-for-approval',
        },
      ),
    )

    expect(narrowed.profileAuthority?.scope).toEqual({})
    for (const session of SESSIONS) {
      expect(
        authorizeSessionTargetForCaller(
          narrowed,
          {
            projectPath: session.projectPath,
            sessionId: session.id,
            hiveRootSessionId: session.hiveRootSessionId,
          },
          ['sessions:discover'],
        ).authorized,
      ).toBe(false)
    }
  })

  it('takes the server scope as is under a catalog-wide profile', async () => {
    const narrowed = await narrow(
      profileCaller(
        {
          capabilities: ['sessions:discover'],
          scope: { all: true },
          authorizationCeiling: 'yolo',
        },
        {
          capabilities: ['sessions:discover'],
          scope: {
            workspaceRoots: ['/repo-a'],
            projectPaths: ['/repo-a/new-project'],
            sessionIds: ['c-root'],
          },
          authorizationCeiling: 'yolo',
        },
      ),
    )

    expect(narrowed.profileAuthority?.scope).toEqual({
      projectPaths: ['/repo-a/new-project', '/repo-a', '/repo-a/packages/sub'],
      sessionIds: ['c-root'],
    })
    expect(narrowed.profileAuthority?.authorizationCeiling).toBe('yolo')
  })

  it('keeps a profile project inside a server workspace even before it has Sessions', async () => {
    const narrowed = await narrow(
      profileCaller(
        {
          capabilities: ['sessions:create'],
          scope: { projectPaths: ['/repo-a/empty', '/repo-b'] },
          authorizationCeiling: 'ask-for-approval',
        },
        {
          capabilities: ['sessions:create'],
          scope: { workspaceRoots: ['/repo-a'] },
          authorizationCeiling: 'ask-for-approval',
        },
      ),
    )

    expect(narrowed.profileAuthority?.scope.projectPaths).toEqual(['/repo-a/empty'])
  })

  it('keeps hive members in both scopes as Session ids and drops the hive grant itself', async () => {
    const narrowed = await narrow(
      profileCaller(
        {
          capabilities: ['sessions:read'],
          scope: { hiveRootSessionIds: ['a-root', 'b-root'] },
          authorizationCeiling: 'ask-for-approval',
        },
        {
          capabilities: ['sessions:read'],
          scope: { workspaceRoots: ['/repo-a'] },
          authorizationCeiling: 'ask-for-approval',
        },
      ),
    )

    expect(narrowed.profileAuthority?.scope).toEqual({ sessionIds: ['a-root', 'a-worker'] })
  })

  it('narrows file roots, derived Worker grants, and drops profile management', async () => {
    const narrowed = await narrow(
      profileCaller(
        {
          capabilities: ['sessions:export', 'sessions:read'],
          scope: {
            projectPaths: ['/repo-a'],
            exportRoots: ['/exports'],
            attachmentRoots: ['/attachments'],
          },
          authorizationCeiling: 'yolo',
          managementEnvelope: {
            capabilities: ['sessions:read'],
            scope: { all: true },
            authorizationCeiling: 'yolo',
          },
        },
        {
          capabilities: ['sessions:read', 'sessions:export'],
          scope: {
            workspaceRoots: ['/repo-a'],
            exportRoots: ['/exports/mcp', '/elsewhere'],
          },
          authorizationCeiling: 'ask-for-approval',
        },
        {
          derivedSessionAuthorities: [
            {
              sessionId: 'a-worker',
              capabilities: ['sessions:report', 'sessions:read'],
              authorizationCeiling: 'yolo',
            },
            {
              sessionId: 'b-root',
              capabilities: ['sessions:read'],
              authorizationCeiling: 'yolo',
            },
          ],
        },
      ),
    )

    expect(narrowed.profileAuthority).toEqual({
      profileId: 'reviewer-id',
      profileName: 'reviewer',
      capabilities: ['sessions:export', 'sessions:read'],
      scope: {
        projectPaths: ['/repo-a'],
        sessionIds: ['a-root', 'a-worker'],
        exportRoots: ['/exports/mcp'],
        attachmentRoots: ['/attachments'],
      },
      authorizationCeiling: 'ask-for-approval',
    })
    expect(narrowed.derivedSessionAuthorities).toEqual([
      {
        sessionId: 'a-worker',
        capabilities: ['sessions:read'],
        authorizationCeiling: 'ask-for-approval',
      },
    ])
  })

  it('fails closed on a narrowing without an explicit scope or with a catalog-wide one', async () => {
    const profile = {
      capabilities: ['sessions:discover' as const],
      scope: { all: true },
      authorizationCeiling: 'yolo' as const,
    }
    for (const scope of [{}, { all: true }, { workspaceRoots: [] }]) {
      const error = await failure(
        profileCaller(profile, {
          capabilities: ['sessions:discover'],
          scope,
          authorizationCeiling: 'yolo',
        }),
      )
      expect(error).toEqual(
        new LocalSessionCommandAuthorizationError({
          code: 'target_scope_denied',
          detail: 'An MCP server narrowing needs an explicit --workspace or --session scope.',
        }),
      )
    }
  })

  it('fails closed when the profile authority is missing', async () => {
    const caller = profileCaller(
      { capabilities: [], scope: { all: true }, authorizationCeiling: 'yolo' },
      {
        capabilities: ['sessions:discover'],
        scope: { workspaceRoots: ['/repo-a'] },
        authorizationCeiling: 'yolo',
      },
    )
    const { profileAuthority: _, ...withoutAuthority } = caller

    await expect(failure(withoutAuthority)).resolves.toMatchObject({ code: 'target_scope_denied' })
  })
})
