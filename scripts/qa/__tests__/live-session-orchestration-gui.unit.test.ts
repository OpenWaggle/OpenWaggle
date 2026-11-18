import { describe, expect, it } from 'vitest'
import { AUTOMATION_IDENTITY_QUERY_PARAM } from '../../../src/shared/constants/electron-automation'
import {
  assertLiveQaPageAutomationIdentity,
  LiveQaCdpIdentityError,
} from '../live-session-orchestration-gui'

describe('live packaged QA renderer identity', () => {
  it('accepts only the renderer identity assigned to the current launch', () => {
    const expectedIdentity = 'expected-live-qa-identity'
    const matchingUrl = new URL('openwaggle://app/')
    matchingUrl.searchParams.set(AUTOMATION_IDENTITY_QUERY_PARAM, expectedIdentity)

    expect(() =>
      assertLiveQaPageAutomationIdentity(matchingUrl.toString(), expectedIdentity),
    ).not.toThrow()
  })

  it('fails closed when the CDP owner presents a different identity', () => {
    const mismatchedUrl = new URL('openwaggle://app/')
    mismatchedUrl.searchParams.set(AUTOMATION_IDENTITY_QUERY_PARAM, 'unrelated-launch')

    expect(() =>
      assertLiveQaPageAutomationIdentity(mismatchedUrl.toString(), 'current-launch'),
    ).toThrow(LiveQaCdpIdentityError)
  })
})
