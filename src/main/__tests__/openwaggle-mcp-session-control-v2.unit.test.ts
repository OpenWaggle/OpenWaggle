import { describe, expect, it } from 'vitest'
import { buildMcpSessionPayloadV2 } from '../openwaggle-mcp-session-tool-v2'

describe('OpenWaggle MCP Session Control v2 control mapping', () => {
  it('maps Delegation review against an exact submission revision', () => {
    expect(
      buildMcpSessionPayloadV2({
        operation: 'delegation-request-revision',
        sessionId: 'parent',
        delegationId: 'delegation-1',
        submissionRevision: 2,
        feedback: 'Add the missing regression test.',
      }),
    ).toMatchObject({
      request: {
        command: {
          operation: 'delegation-request-revision',
          sessionId: 'parent',
          delegationId: 'delegation-1',
          submissionRevision: 2,
          feedback: 'Add the missing regression test.',
        },
      },
    })
  })

  it('maps reasoned Delegation reopening without inventing a submission revision', () => {
    expect(
      buildMcpSessionPayloadV2({
        operation: 'delegation-reopen',
        sessionId: 'parent',
        delegationId: 'delegation-1',
        reason: 'The target changed.',
      }),
    ).toMatchObject({
      request: {
        command: {
          operation: 'delegation-reopen',
          sessionId: 'parent',
          delegationId: 'delegation-1',
          reason: 'The target changed.',
        },
      },
    })
  })

  it('maps a Worker-owned Delegation state transition', () => {
    expect(
      buildMcpSessionPayloadV2({
        operation: 'delegation-state',
        sessionId: 'worker',
        delegationId: 'delegation-1',
        delegationState: 'needs_attention',
        reason: 'The provider failed.',
      }),
    ).toMatchObject({
      request: {
        command: {
          operation: 'delegation-state',
          state: 'needs_attention',
          reason: 'The provider failed.',
        },
      },
    })
  })

  it('maps stop-all to explicit descendant interruption without targeting the parent Run', () => {
    expect(
      buildMcpSessionPayloadV2({ operation: 'interrupt-descendants', sessionId: 'queen' }),
    ).toMatchObject({
      request: { command: { operation: 'interrupt-descendants', sessionId: 'queen' } },
    })
  })

  it('maps parked request reads and explicit approval responses', () => {
    expect(
      buildMcpSessionPayloadV2({ operation: 'requests-list', sessionId: 'worker' }),
    ).toMatchObject({
      request: { query: { operation: 'requests-list', sessionId: 'worker' } },
    })
    expect(
      buildMcpSessionPayloadV2({
        operation: 'approval-respond',
        sessionId: 'worker',
        runId: 'run-worker',
        interactionId: 'approval-1',
        interactionResponse: { kind: 'confirm', accepted: true },
      }),
    ).toMatchObject({
      request: {
        command: {
          operation: 'approval-respond',
          sessionId: 'worker',
          runId: 'run-worker',
          interactionId: 'approval-1',
        },
      },
    })
  })

  it('maps persistent Authorization changes separately from one approval', () => {
    expect(
      buildMcpSessionPayloadV2({
        operation: 'authorization-set',
        sessionId: 'worker',
        authorizationMode: 'inherit',
      }),
    ).toMatchObject({
      request: {
        command: {
          operation: 'authorization-set',
          sessionId: 'worker',
          authorizationMode: null,
        },
      },
    })
  })
})
