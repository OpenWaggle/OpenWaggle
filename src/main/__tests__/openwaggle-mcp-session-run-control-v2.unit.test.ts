import { describe, expect, it } from 'vitest'
import { buildMcpSessionPayloadV2 } from '../openwaggle-mcp-session-tool-v2'

describe('OpenWaggle MCP Session Run Control v2 adapter', () => {
  it('maps Worker spawn to exact parent Run and Workspace placement', () => {
    expect(
      buildMcpSessionPayloadV2({
        operation: 'spawn',
        sessionId: 'session-parent',
        expectedRunId: 'run-parent',
        objective: 'Review authorization',
        workspace: 'new-worktree',
        agent: 'security-reviewer',
      }),
    ).toMatchObject({
      contract: 'session-lifecycle-v2',
      request: {
        command: {
          operation: 'spawn',
          parentSessionId: 'session-parent',
          expectedParentRunId: 'run-parent',
          workspace: { mode: 'new-worktree' },
          specialization: { agentDefinitionName: 'security-reviewer' },
        },
      },
    })
  })

  it('preserves Follow-up, Steering, and bounded wait as different operations', () => {
    expect(
      buildMcpSessionPayloadV2({
        operation: 'follow-up',
        sessionId: 'worker',
        message: 'Run QA next.',
      }),
    ).toMatchObject({ request: { command: { operation: 'follow-up' } } })
    expect(
      buildMcpSessionPayloadV2({
        operation: 'steer',
        sessionId: 'worker',
        expectedRunId: 'run-worker',
        message: 'Use the current schema.',
      }),
    ).toMatchObject({
      request: { command: { operation: 'steer', expectedRunId: 'run-worker' } },
    })
    expect(
      buildMcpSessionPayloadV2({
        operation: 'wait',
        sessionIds: ['worker', 'worker-2'],
        condition: 'idle',
        timeoutMs: 30_000,
      }),
    ).toMatchObject({ request: { query: { operation: 'wait', timeoutMs: 30_000 } } })
  })

  it('maps exact queued Follow-up promotion and explicit Run authorization', () => {
    expect(
      buildMcpSessionPayloadV2({
        operation: 'promote',
        sessionId: 'worker',
        followUpId: 'follow-up-1',
        expectedRunId: 'run-worker',
      }),
    ).toMatchObject({
      request: {
        command: {
          operation: 'promote',
          sessionId: 'worker',
          followUpId: 'follow-up-1',
          expectedRunId: 'run-worker',
        },
      },
    })
    expect(
      buildMcpSessionPayloadV2({
        operation: 'start',
        sessionId: 'worker',
        message: 'Run with approval prompts.',
        runAuthorizationOverride: 'ask-for-approval',
      }),
    ).toMatchObject({
      request: {
        command: { operation: 'start', runAuthorizationOverride: 'ask-for-approval' },
      },
    })
    expect(() =>
      buildMcpSessionPayloadV2({
        operation: 'steer',
        sessionId: 'worker',
        expectedRunId: 'run-worker',
        message: 'Do not restart.',
        runAuthorizationOverride: 'yolo',
      }),
    ).toThrow('Steer does not accept Run authorization')
  })
})
