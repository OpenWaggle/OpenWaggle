import type { LocalSessionCallerIdentity } from '@shared/types/local-session-profile'
import { describe, expect, it } from 'vitest'
import { profileAuthorityForCapabilities } from '../local-session-derived-authority'

const PROJECT_PATH = '/project'

function callerWithDerivedReportAuthority(): LocalSessionCallerIdentity {
  const scope = {
    projectPaths: [PROJECT_PATH],
    exportRoots: [PROJECT_PATH],
    attachmentRoots: [PROJECT_PATH],
  }
  return {
    callerId: 'profile:worker-client',
    baseProfileScope: scope,
    profileAuthority: {
      profileId: 'worker-client',
      profileName: 'worker-client',
      capabilities: ['sessions:discover'],
      scope,
      authorizationCeiling: 'ask-for-approval',
    },
    derivedSessionAuthorities: [
      {
        sessionId: 'session-worker',
        capabilities: ['sessions:report'],
        authorizationCeiling: 'ask-for-approval',
      },
    ],
  }
}

describe('local Session derived authority', () => {
  it('does not attach base Session scope to a capability supplied only by a derived grant', () => {
    const caller = callerWithDerivedReportAuthority()

    expect(profileAuthorityForCapabilities(caller, ['sessions:report'])?.scope).toEqual({
      exportRoots: [PROJECT_PATH],
      attachmentRoots: [PROJECT_PATH],
      sessionIds: ['session-worker'],
    })
  })

  it('retains base Session scope when the base profile supplies the capability', () => {
    const caller = callerWithDerivedReportAuthority()
    if (!caller.profileAuthority) throw new Error('Expected a profile authority.')

    expect(
      profileAuthorityForCapabilities(
        {
          ...caller,
          profileAuthority: {
            ...caller.profileAuthority,
            capabilities: ['sessions:report'],
          },
        },
        ['sessions:report'],
      )?.scope,
    ).toEqual({
      projectPaths: [PROJECT_PATH],
      exportRoots: [PROJECT_PATH],
      attachmentRoots: [PROJECT_PATH],
      sessionIds: ['session-worker'],
    })
  })
})
