import { HOST_UI_REVISION_23_REQUIRED_CHANNELS } from '@shared/types/host-ui-protocol'
import { LOCAL_SESSION_SOURCE_CONTROL_REVISION } from '@shared/types/local-session-protocol-revisions'
import { describe, expect, it } from 'vitest'
import { requiredHostUiRevision } from '../local-session-command-revision'

describe('Session Host source-control channels', () => {
  it('names revision 23 for every channel that moved into the Session Host', () => {
    expect(LOCAL_SESSION_SOURCE_CONTROL_REVISION).toBe(23)
    expect([...HOST_UI_REVISION_23_REQUIRED_CHANNELS].sort()).toEqual([
      'git:change-request:merge-candidate',
      'git:change-request:merge-confirmed',
      'git:change-request:panel',
      'git:session:record-outputs',
      'git:session:verify-working-path',
      'source-control:patch-settings',
    ])
    for (const channel of HOST_UI_REVISION_23_REQUIRED_CHANNELS) {
      expect(requiredHostUiRevision({ channel, args: [] })).toBe(
        LOCAL_SESSION_SOURCE_CONTROL_REVISION,
      )
    }
  })
})
