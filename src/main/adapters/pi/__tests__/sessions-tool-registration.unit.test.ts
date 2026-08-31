import type { ExtensionAPI, ToolDefinition } from '@earendil-works/pi-coding-agent'
import { fromPartial } from '@total-typescript/shoehorn'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { installSessionToolGateway } from '../../../session-host/session-tool-gateway'
import { createSessionsToolExtension } from '../sessions-tool-extension'

describe('Pi-native Sessions tool registration', () => {
  let releaseGateway: (() => void) | undefined

  afterEach(() => {
    releaseGateway?.()
  })

  it('registers one compact native tool and calls the in-process gateway', async () => {
    const gateway = vi.fn(async () => ({
      contract: 'session-query-v2' as const,
      response: {
        contractVersion: 2 as const,
        requestId: 'query',
        outcome: { operation: 'list' as const, sessions: [] },
      },
    }))
    releaseGateway = installSessionToolGateway(gateway)
    let tool: ToolDefinition | undefined
    createSessionsToolExtension({
      sessionId: 'session-queen',
      runId: 'run-current',
      workingDirectory: '/project',
    })(
      fromPartial<ExtensionAPI>({
        registerTool: (registered: ToolDefinition) => {
          tool = registered
        },
      }),
    )

    expect(tool).toMatchObject({ name: 'sessions', executionMode: 'sequential' })
    expect(tool?.description).toContain('Queen Session')
    const controller = new AbortController()
    const result = await tool?.execute(
      'tool-call',
      { action: 'list', limit: 10 },
      controller.signal,
      () => undefined,
      fromPartial({}),
    )

    expect(result?.content).toEqual([expect.objectContaining({ type: 'text' })])
    expect(gateway).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceSessionId: 'session-queen',
        sourceRunId: 'run-current',
        workingDirectory: '/project',
        signal: controller.signal,
        payload: expect.objectContaining({ contract: 'session-query-v2' }),
      }),
    )
  })

  it('executes a Worker spawn through the same in-process Session gateway', async () => {
    const gateway = vi.fn(async () => ({
      contract: 'session-lifecycle-v2' as const,
      response: {
        contractVersion: 2 as const,
        requestId: 'spawn-request',
        idempotencyKey: 'spawn-key',
        replayed: false,
        outcome: {
          operation: 'spawn' as const,
          effect: 'spawned-worker' as const,
          sessionId: 'session-worker',
          runId: 'run-worker',
          workspaceId: 'workspace-worker',
          parentSessionId: 'session-queen',
          parentRunId: 'run-queen',
          hiveRootSessionId: 'session-queen',
          depth: 1,
          delegationId: 'delegation-worker',
          derivedGrantId: 'grant-worker',
        },
      },
    }))
    releaseGateway = installSessionToolGateway(gateway)
    let tool: ToolDefinition | undefined
    createSessionsToolExtension({
      sessionId: 'session-queen',
      runId: 'run-queen',
      workingDirectory: '/project',
      projectPath: '/project',
    })(
      fromPartial<ExtensionAPI>({
        registerTool: (registered: ToolDefinition) => {
          tool = registered
        },
      }),
    )

    const result = await tool?.execute(
      'spawn-call',
      {
        action: 'spawn',
        objective: 'Verify the Session Host boundary.',
        workspace: 'share-parent',
        deliverables: ['Review findings'],
        acceptanceCriteria: ['No P1 findings'],
      },
      new AbortController().signal,
      () => undefined,
      fromPartial({}),
    )

    expect(result).toMatchObject({
      details: {
        response: {
          outcome: {
            operation: 'spawn',
            sessionId: 'session-worker',
            runId: 'run-worker',
          },
        },
      },
    })
    expect(gateway).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceSessionId: 'session-queen',
        sourceRunId: 'run-queen',
        payload: expect.objectContaining({
          contract: 'session-lifecycle-v2',
          request: expect.objectContaining({
            command: expect.objectContaining({
              operation: 'spawn',
              parentSessionId: 'session-queen',
              expectedParentRunId: 'run-queen',
              workspace: { mode: 'share-parent' },
            }),
          }),
        }),
      }),
    )
  })
})
