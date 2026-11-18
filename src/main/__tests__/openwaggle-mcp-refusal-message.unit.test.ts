import { describe, expect, it } from 'vitest'
import { mcpLocalRefusal, mcpThrownRefusal } from '../openwaggle-mcp-refusal-message'
import { LocalSessionClientProtocolError } from '../session-host/local-session-client-protocol-error'

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

/** Every refusal of the `openwaggle_hive` tool starts with its code and kind (ADR 0063). */
describe('openwaggle_hive refusal messages', () => {
  it('names the kind of a refusal the Session Host threw', () => {
    expect(
      messageOf(
        mcpThrownRefusal(
          new LocalSessionClientProtocolError(
            'target_scope_denied',
            'Session command refused (target_scope_denied): outside scope.',
            { errorKind: 'authorization' },
          ),
        ),
      ),
    ).toBe(
      'target_scope_denied (authorization): Session command refused (target_scope_denied): outside scope.',
    )
    // An older Session Host's frame has no kind: the table names it.
    expect(
      messageOf(mcpThrownRefusal(new LocalSessionClientProtocolError('capability_denied', 'No.'))),
    ).toBe('capability_denied (authorization): No.')
  })

  it('leaves other failures alone and names the kind of its own refusals', () => {
    const failure = new Error('socket closed')
    expect(mcpThrownRefusal(failure)).toBe(failure)
    expect(messageOf(mcpLocalRefusal('session_not_found', 'Gone.'))).toBe(
      'session_not_found (not_found): Gone.',
    )
  })
})
