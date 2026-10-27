import type { HostBackedGuiChannel, HostUiWireValue } from '@shared/types/host-ui-protocol'
import { LOCAL_SESSION_SESSION_DATA_REVISION } from '@shared/types/local-session-protocol-revisions'
import { describe, expect, it } from 'vitest'
import { requiredHostUiRevision } from '../local-session-command-revision'

/** Only the argument count matters to the revision; each argument is a wire value. */
function request(channel: HostBackedGuiChannel, argumentCount: number) {
  const args: HostUiWireValue[] = Array.from({ length: argumentCount }, () => ({
    kind: 'value',
    value: null,
  }))
  return { channel, args }
}

describe('Session Host revision 28 requests', () => {
  it('needs revision 28 for the arguments the v1 performance work added', () => {
    expect(LOCAL_SESSION_SESSION_DATA_REVISION).toBe(28)
    for (const [channel, argumentCount] of [
      ['providers:get-models', 2],
      ['sessions:get-detail', 2],
      ['sessions:get-workspace', 3],
    ] as const) {
      expect(requiredHostUiRevision(request(channel, argumentCount))).toBe(
        LOCAL_SESSION_SESSION_DATA_REVISION,
      )
    }
  })

  it('keeps the older argument counts on their earlier revisions', () => {
    expect(requiredHostUiRevision(request('providers:get-models', 1))).toBeLessThan(
      LOCAL_SESSION_SESSION_DATA_REVISION,
    )
    expect(requiredHostUiRevision(request('sessions:get-detail', 1))).toBeLessThan(
      LOCAL_SESSION_SESSION_DATA_REVISION,
    )
  })
})
