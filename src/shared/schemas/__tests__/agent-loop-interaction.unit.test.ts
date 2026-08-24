import { Schema } from '@shared/schema'
import { agentLoopResponseInputSchema } from '@shared/schemas/agent-loop-interaction'
import { AGENT_AUTHORIZATION_DECISION_SCOPES } from '@shared/types/agent-authorization-grants'
import { describe, expect, it } from 'vitest'

/**
 * These decode through the real IPC schema rather than calling the broker directly.
 *
 * A response field that exists on the TypeScript type but not in the schema is silently deleted by
 * Effect Schema, and the union's type annotation hides that from the compiler. That is how the
 * approval scope was lost between the ribbon and the authorization path while every other test
 * stayed green: the unit tests submitted responses to the broker without crossing this boundary.
 */
describe('agentLoopResponseInputSchema', () => {
  const decode = Schema.decodeUnknownSync(agentLoopResponseInputSchema)

  const envelope = {
    interactionId: 'interaction-1',
    kind: 'confirm' as const,
    runId: 'run-1',
    sessionId: 'session-1',
  }

  it.each(AGENT_AUTHORIZATION_DECISION_SCOPES)('preserves the %s decision scope', (scope) => {
    const decoded = decode({ ...envelope, response: { accepted: true, kind: 'confirm', scope } })

    expect(decoded.response).toEqual({ accepted: true, kind: 'confirm', scope })
  })

  it('omits the scope when the decision carries none', () => {
    const decoded = decode({ ...envelope, response: { accepted: true, kind: 'confirm' } })

    expect(decoded.response).toEqual({ accepted: true, kind: 'confirm' })
  })

  it('rejects a scope outside the declared set instead of dropping it', () => {
    expect(() =>
      decode({ ...envelope, response: { accepted: true, kind: 'confirm', scope: 'forever' } }),
    ).toThrow()
  })

  it('keeps every other response payload intact across the boundary', () => {
    expect(
      decode({ ...envelope, kind: 'select', response: { kind: 'select', selected: 'first' } })
        .response,
    ).toEqual({ kind: 'select', selected: 'first' })
    expect(
      decode({ ...envelope, kind: 'input', response: { kind: 'input', value: 'typed' } }).response,
    ).toEqual({ kind: 'input', value: 'typed' })
    expect(
      decode({ ...envelope, kind: 'editor', response: { kind: 'editor', value: null } }).response,
    ).toEqual({ kind: 'editor', value: null })
    expect(
      decode({ ...envelope, kind: 'notify', response: { acknowledged: true, kind: 'notify' } })
        .response,
    ).toEqual({ acknowledged: true, kind: 'notify' })
    expect(
      decode({ ...envelope, kind: 'custom', response: { kind: 'custom', value: { ok: true } } })
        .response,
    ).toEqual({ kind: 'custom', value: { ok: true } })
  })
})
