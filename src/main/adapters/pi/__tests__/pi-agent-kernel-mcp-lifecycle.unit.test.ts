import { fromPartial } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import { describe, expect, it, vi } from 'vitest'
import type { McpConfigServiceShape } from '../../../ports/mcp-config-service'
import type { McpRuntimeServiceShape } from '../../../ports/mcp-runtime-service'
import { snapshot } from '../../mcp/__tests__/mcp-runtime-test-utils'
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
})
