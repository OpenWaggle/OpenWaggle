import type {
  LocalSessionCallerIdentity,
  LocalSessionProfileScope,
} from '@shared/types/local-session-profile'
import { fromPartial } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import { describe, expect, it } from 'vitest'
import { SessionAuthorizationTargetRepository } from '../../ports/session-authorization-target-repository'
import {
  AUTHORITY_LIMITS_PROFILE_ID,
  applyAuthorityLimits,
  intersectAuthorityLimits,
  intersectAuthorityScopes,
  localUserWithinLimits,
} from '../local-session-authority-limits'

const LIMITS = {
  capabilities: ['sessions:read', 'sessions:start'] as const,
  scope: { projectPaths: ['/repo'], exportRoots: ['/repo/worktree'] },
  authorizationCeiling: 'ask-for-approval' as const,
}

/** Sessions by the project they are in, as the Session catalog would admit them. */
const CATALOG: Readonly<Record<string, readonly string[]>> = {
  '/repo': ['in-repo'],
  '/other': ['in-other'],
}

function apply(caller: LocalSessionCallerIdentity) {
  return Effect.runPromise(
    applyAuthorityLimits(caller).pipe(
      Effect.provideService(
        SessionAuthorizationTargetRepository,
        fromPartial({
          listAuthorizedSessionIds: (scope: LocalSessionProfileScope) =>
            Effect.succeed([
              ...(scope.sessionIds ?? []),
              ...(scope.projectPaths ?? []).flatMap(
                (projectPath: string) => CATALOG[projectPath] ?? [],
              ),
            ]),
        }),
      ),
    ),
  )
}

function profileCaller(
  scope: NonNullable<LocalSessionCallerIdentity['profileAuthority']>['scope'],
  limits: LocalSessionCallerIdentity['authorityLimits'],
): LocalSessionCallerIdentity {
  return {
    callerId: 'profile:ci',
    ...(limits === undefined ? {} : { authorityLimits: limits }),
    profileAuthority: {
      profileId: 'ci',
      profileName: 'CI',
      capabilities: ['sessions:read', 'sessions:organize'],
      scope,
      authorizationCeiling: 'yolo',
    },
    derivedSessionAuthorities: [
      { sessionId: 'worker', capabilities: ['sessions:read'], authorizationCeiling: 'yolo' },
    ],
  }
}

describe('applyAuthorityLimits', () => {
  it('leaves a caller without limits as it is', async () => {
    const caller: LocalSessionCallerIdentity = { callerId: 'local-user' }
    expect(await apply(caller)).toBe(caller)
  })

  it('gives the local user exactly the limits as its authority, and again unchanged', async () => {
    const limited = localUserWithinLimits({ callerId: 'local-user' }, LIMITS)
    expect(limited.profileAuthority).toEqual({
      profileId: AUTHORITY_LIMITS_PROFILE_ID,
      profileName: AUTHORITY_LIMITS_PROFILE_ID,
      capabilities: ['sessions:read', 'sessions:start'],
      scope: LIMITS.scope,
      authorizationCeiling: 'ask-for-approval',
    })
    expect(limited.baseProfileScope).toEqual(LIMITS.scope)
    expect(await apply(limited)).toEqual(limited)
  })

  it('keeps what both a catalog-wide profile and the limits allow, and drops Worker grants', async () => {
    const limited = await apply(profileCaller({ all: true }, LIMITS))
    expect(limited.profileAuthority).toMatchObject({
      profileId: 'ci',
      capabilities: ['sessions:read'],
      scope: { projectPaths: ['/repo'] },
      authorizationCeiling: 'ask-for-approval',
    })
    expect(limited.derivedSessionAuthorities).toBeUndefined()
  })

  it('keeps a Session the limits name when the live profile reaches it through its project', async () => {
    const limited = await apply(
      profileCaller(
        { projectPaths: ['/repo'] },
        { ...LIMITS, scope: { sessionIds: ['in-repo', 'in-other'] } },
      ),
    )
    expect(limited.profileAuthority?.scope).toEqual({ sessionIds: ['in-repo'] })
  })
})

describe('intersectAuthorityScopes', () => {
  it('keeps only the entries two listed scopes share', () => {
    expect(
      intersectAuthorityScopes(
        { projectPaths: ['/a', '/b'], sessionIds: ['s1'] },
        { projectPaths: ['/b', '/c'], sessionIds: ['s2'] },
      ),
    ).toEqual({ projectPaths: ['/b'] })
  })

  it('lets a catalog-wide side admit what the other lists', () => {
    expect(intersectAuthorityScopes({ projectPaths: ['/a'] }, { all: true })).toEqual({
      projectPaths: ['/a'],
    })
    expect(intersectAuthorityScopes({ all: true }, { all: true })).toEqual({ all: true })
  })
})

describe('intersectAuthorityLimits', () => {
  it('treats null as no limits and otherwise keeps the narrower of each', () => {
    expect(intersectAuthorityLimits(null, LIMITS)).toBe(LIMITS)
    expect(intersectAuthorityLimits(LIMITS, null)).toBe(LIMITS)
    expect(
      intersectAuthorityLimits(
        { capabilities: ['sessions:read'], scope: { all: true }, authorizationCeiling: 'yolo' },
        LIMITS,
      ),
    ).toEqual({
      capabilities: ['sessions:read'],
      scope: { projectPaths: ['/repo'] },
      authorizationCeiling: 'ask-for-approval',
    })
  })
})
