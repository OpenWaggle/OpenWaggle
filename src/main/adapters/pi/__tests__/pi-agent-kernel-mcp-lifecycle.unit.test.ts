import { fromPartial } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import { describe, expect, it, vi } from 'vitest'
import type { McpConfigServiceShape } from '../../../ports/mcp-config-service'
import type { McpRuntimeServiceShape } from '../../../ports/mcp-runtime-service'
import { server, snapshot } from '../../mcp/__tests__/mcp-runtime-test-utils'
import { prepareMcpTurn } from '../pi-agent-kernel-adapter'

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
})
