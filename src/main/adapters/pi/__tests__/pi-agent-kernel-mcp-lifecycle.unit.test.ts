import { fromPartial } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import { describe, expect, it, vi } from 'vitest'
import type { AgentKernelRunInput } from '../../../ports/agent-kernel-service'
import type { McpConfigServiceShape } from '../../../ports/mcp-config-service'
import type {
  McpDirectToolListOptions,
  McpRuntimeServiceShape,
} from '../../../ports/mcp-runtime-service'
import { server, snapshot } from '../../mcp/__tests__/mcp-runtime-test-utils'
import { prepareMcpTurn } from '../pi-agent-kernel-adapter'
import { createWorktreeLaunchReporter } from '../pi-agent-kernel-launch'

describe('Pi MCP turn preparation lifecycle', () => {
  it('disposes the active MCP turn when direct-tool preparation fails', async () => {
    const turn = snapshot({ sessionId: 'failed-direct-tools-session' })
    const disposeSession = vi.fn(() => Effect.void)
    const config = fromPartial<McpConfigServiceShape>({
      createTurnSnapshot: () => Effect.succeed(turn),
    })
    const runtime = fromPartial<McpRuntimeServiceShape>({
      prepareTurn: () => Effect.void,
      listDirectTools: () => Effect.fail(new Error('required direct tool unavailable')),
      disposeSession,
    })

    await expect(
      Effect.runPromise(
        prepareMcpTurn({
          projectPath: turn.projectPath,
          executionPath: turn.projectPath,
          sessionId: turn.sessionId,
          config,
          runtime,
        }),
      ),
    ).rejects.toThrow('required direct tool unavailable')
    expect(disposeSession).toHaveBeenCalledWith(turn.sessionId)
  })

  it('prepares and exposes only MCP servers allowed by the immutable Agent profile', async () => {
    const turn = snapshot({
      servers: [
        server({ instanceId: 'github-id', name: 'github' }),
        server({ instanceId: 'linear-id', name: 'linear' }),
      ],
    })
    const prepareTurn = vi.fn(() => Effect.void)
    const listDirectTools = vi.fn(() => Effect.succeed([]))
    const config = fromPartial<McpConfigServiceShape>({
      createTurnSnapshot: () => Effect.succeed(turn),
    })
    const runtime = fromPartial<McpRuntimeServiceShape>({
      prepareTurn,
      listDirectTools,
      completeTurn: () => Effect.void,
      disposeSession: () => Effect.void,
    })

    const prepared = await Effect.runPromise(
      prepareMcpTurn({
        projectPath: turn.projectPath,
        executionPath: turn.projectPath,
        sessionId: turn.sessionId,
        serverAllowlist: ['github'],
        config,
        runtime,
      }),
    )
    expect(prepareTurn).toHaveBeenCalledWith({
      sessionId: turn.sessionId,
      snapshot: expect.objectContaining({
        servers: [expect.objectContaining({ name: 'github' })],
      }),
    })
    expect(listDirectTools).toHaveBeenCalledWith(
      expect.objectContaining({ servers: [expect.objectContaining({ name: 'github' })] }),
      expect.anything(),
    )
    await Effect.runPromise(prepared.finish)
  })

  it('turns MCP off when an Agent profile explicitly allows no servers', async () => {
    const turn = snapshot()
    const prepareTurn = vi.fn(() => Effect.void)
    const config = fromPartial<McpConfigServiceShape>({
      createTurnSnapshot: () => Effect.succeed(turn),
    })
    const runtime = fromPartial<McpRuntimeServiceShape>({
      prepareTurn,
      completeTurn: () => Effect.void,
      disposeSession: () => Effect.void,
    })

    const prepared = await Effect.runPromise(
      prepareMcpTurn({
        projectPath: turn.projectPath,
        executionPath: turn.projectPath,
        sessionId: turn.sessionId,
        serverAllowlist: [],
        config,
        runtime,
      }),
    )
    expect(prepareTurn).toHaveBeenCalledWith({ sessionId: turn.sessionId, snapshot: null })
    expect(prepared.extensionFactory).toBeUndefined()
    await Effect.runPromise(prepared.finish)
  })

  it.each([
    { waitsFor: [], reported: [] },
    { waitsFor: ['atlassian'], reported: ['connecting:atlassian', 'connected'] },
  ])('reports a connecting step only when the turn waits for servers: $waitsFor', async (c) => {
    const turn = snapshot({
      servers: [server({ name: 'atlassian', definition: { command: 'a', directTools: true } })],
    })
    const reported: string[] = []
    const runtime = fromPartial<McpRuntimeServiceShape>({
      prepareTurn: () => Effect.void,
      listDirectTools: (_snapshot: unknown, options?: McpDirectToolListOptions) =>
        Effect.sync(() => {
          if (c.waitsFor.length === 0) return []
          options?.onWaiting?.(c.waitsFor)
          options?.onWaitSettled?.({ connected: c.waitsFor, stillConnecting: [], unavailable: [] })
          return []
        }),
      completeTurn: () => Effect.void,
      disposeSession: () => Effect.void,
    })

    const prepared = await Effect.runPromise(
      prepareMcpTurn({
        projectPath: turn.projectPath,
        executionPath: turn.projectPath,
        sessionId: turn.sessionId,
        config: fromPartial<McpConfigServiceShape>({
          createTurnSnapshot: () => Effect.succeed(turn),
        }),
        runtime,
        onConnecting: (names) => reported.push(`connecting:${names.join(',')}`),
        onConnected: () => reported.push('connected'),
      }),
    )

    expect(reported).toEqual(c.reported)
    await Effect.runPromise(prepared.finish)
  })

  it.each([
    [{ connected: ['atlassian'], stillConnecting: [], unavailable: [] }, undefined],
    [
      { connected: ['atlassian'], stillConnecting: ['playwright'], unavailable: ['figma'] },
      'MCP servers: atlassian connected; playwright still connecting; figma unavailable',
    ],
  ])('labels the finished MCP step with servers that did not connect: %j', (outcome, label) => {
    const onWorktreeLaunch = vi.fn()
    const reporter = createWorktreeLaunchReporter(
      fromPartial<AgentKernelRunInput>({
        session: { environmentMode: 'local', messages: [] },
        onWorktreeLaunch,
      }),
    )

    reporter.reportConnectingTools(['atlassian', 'playwright', 'figma'])
    reporter.reportToolsConnected(outcome)

    expect(onWorktreeLaunch).toHaveBeenLastCalledWith({
      stage: 'connecting-tools',
      environment: 'local',
      completesStep: true,
      ...(label ? { label } : {}),
      details: label ? [label] : [],
    })
  })
})
