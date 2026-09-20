import type { LocalSessionCallerIdentity } from '@shared/types/local-session-profile'
import type { LocalSessionCommandPayload } from '@shared/types/local-session-protocol'
import * as Effect from 'effect/Effect'
import { describe, expect, it } from 'vitest'
import {
  authorizationLayer,
  controlPayload,
  startPayload,
} from '../application/__tests__/local-session-command-dispatcher.test-support'
import { authorizeLocalSessionCommand } from '../application/local-session-command-authorization'
import { buildMcpSessionPayloadV2, mcpTransientAuthority } from '../openwaggle-mcp-session-tool-v2'

function mcpCaller(
  authorizationCeiling: 'ask-for-approval' | 'yolo',
  capabilities: readonly ('sessions:start' | 'sessions:steer' | 'sessions:queue')[],
  payload: LocalSessionCommandPayload,
): LocalSessionCallerIdentity {
  const authority = mcpTransientAuthority(
    {
      transport: 'stdio',
      grants: new Set(capabilities),
      workspaceRoots: ['/allowed-project'],
      sessionIds: new Set(['session-worker']),
      profile: 'run-controller',
      authorizationCeiling,
      userDataRoot: '/tmp/openwaggle-test',
      version: 'test',
    },
    payload,
  )
  return {
    callerId: 'transient-mcp:run-controller',
    profileAuthority: authority,
    baseProfileScope: authority.scope,
  }
}

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

  it.each([
    {
      label: 'YOLO start',
      capabilities: ['sessions:start'] as const,
      payload: startPayload('yolo'),
    },
    {
      label: 'active-Run steering',
      capabilities: ['sessions:steer'] as const,
      payload: controlPayload({
        operation: 'steer',
        sessionId: 'session-worker',
        expectedRunId: 'run-worker',
        input: { text: 'Use the corrected schema.', attachmentIds: [] },
      }),
    },
    {
      label: 'queued Follow-up promotion',
      capabilities: ['sessions:queue', 'sessions:steer'] as const,
      payload: controlPayload({
        operation: 'promote',
        sessionId: 'session-worker',
        expectedRunId: 'run-worker',
        followUpId: 'follow-up-1',
      }),
    },
  ])(
    'admits MCP $label only under the reviewed YOLO ceiling',
    async ({ capabilities, payload }) => {
      const askError = await Effect.runPromise(
        authorizeLocalSessionCommand({
          caller: mcpCaller('ask-for-approval', capabilities, payload),
          payload,
        })
          .pipe(Effect.flip)
          .pipe(Effect.provide(authorizationLayer)),
      )
      expect(askError).toMatchObject({ code: 'authorization_ceiling_exceeded' })

      await expect(
        Effect.runPromise(
          authorizeLocalSessionCommand({
            caller: mcpCaller('yolo', capabilities, payload),
            payload,
          }).pipe(Effect.provide(authorizationLayer)),
        ),
      ).resolves.toBeUndefined()
    },
  )
})
