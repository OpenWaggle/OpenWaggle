import { SessionId, SupportedModelId } from '@shared/types/brand'
import { fromPartial } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  AgentKernelRunInput,
  AgentKernelWaggleRunOptions,
} from '../../../ports/agent-kernel-service'
import type { InlineVisualizationServiceShape } from '../../../ports/inline-visualization-service'
import type { McpConfigServiceShape } from '../../../ports/mcp-config-service'
import type { McpRuntimeServiceShape } from '../../../ports/mcp-runtime-service'
import { server, snapshot } from '../../mcp/__tests__/mcp-runtime-test-utils'
import { runPiAgentKernel } from '../pi-agent-kernel-run'

const runMocks = vi.hoisted(() => ({
  ensureSessionWorktreeProjectPath: vi.fn(async () => '/repo/worktree'),
  runPiSession: vi.fn(),
  runPiWaggle: vi.fn(),
  sessionsExtensionFactory: vi.fn(),
  createSessionsToolExtension: vi.fn(),
}))

vi.mock('../agent-kernel/classic-run', () => ({ runPiSession: runMocks.runPiSession }))
vi.mock('../agent-kernel/session-manager', () => ({
  requireSessionProjectPath: () => '/repo',
}))
vi.mock('../agent-kernel/session-worktree-birth', () => ({
  ensureSessionWorktreeProjectPath: runMocks.ensureSessionWorktreeProjectPath,
}))
vi.mock('../agent-kernel/waggle-run', () => ({ runPiWaggle: runMocks.runPiWaggle }))
vi.mock('../sessions-tool-extension', () => ({
  createSessionsToolExtension: runMocks.createSessionsToolExtension,
}))

describe('runPiAgentKernel', () => {
  beforeEach(() => {
    for (const mock of Object.values(runMocks)) mock.mockReset()
    runMocks.ensureSessionWorktreeProjectPath.mockResolvedValue('/repo/worktree')
    runMocks.createSessionsToolExtension.mockReturnValue(runMocks.sessionsExtensionFactory)
  })

  it('injects the scoped Sessions extension and preserves MCP and visualization restrictions', async () => {
    const turn = snapshot({
      servers: [
        server({ instanceId: 'github-id', name: 'github' }),
        server({ instanceId: 'linear-id', name: 'linear' }),
      ],
    })
    const prepareTurn = vi.fn(() => Effect.void)
    const completeTurn = vi.fn(() => Effect.void)
    runMocks.runPiSession.mockResolvedValue({
      newMessages: [],
      piSessionId: 'pi-session',
      sessionSnapshot: { nodes: [], activeNodeId: null },
    })

    const input = fromPartial<AgentKernelRunInput>({
      session: {
        id: SessionId('session-1'),
        projectPath: '/repo',
      },
      runId: 'run-1',
      payload: { text: 'Coordinate workers', thinkingLevel: 'medium', attachments: [] },
      model: SupportedModelId('openai/gpt-5.4'),
      signal: new AbortController().signal,
      onEvent: vi.fn(),
      sessionCapabilities: ['sessions:spawn', 'sessions:read'],
      modelMultiAgentEnabled: false,
      mcpServerAllowlist: ['github'],
    })
    const mcpConfig = fromPartial<McpConfigServiceShape>({
      createTurnSnapshot: () => Effect.succeed(turn),
    })
    const mcpRuntime = fromPartial<McpRuntimeServiceShape>({
      prepareTurn,
      listDirectTools: () => Effect.succeed([]),
      completeTurn,
      disposeSession: () => Effect.void,
    })
    const inlineVisualization = fromPartial<InlineVisualizationServiceShape>({
      prepareSession: () => Effect.succeed('/visualizations/session-1'),
    })

    await Effect.runPromise(
      runPiAgentKernel(input, {
        runtimeExtensionIsolation: {},
        terminal: fromPartial({}),
        browserPreviewAutomation: fromPartial({}),
        enableBrowserPreviewAutomation: false,
        mcpConfig,
        mcpRuntime,
        inlineVisualization,
      }),
    )

    expect(runMocks.createSessionsToolExtension).toHaveBeenCalledWith({
      sessionId: SessionId('session-1'),
      runId: 'run-1',
      workingDirectory: '/repo/worktree',
      projectPath: '/repo',
      sessionCapabilities: ['sessions:spawn', 'sessions:read'],
      modelMultiAgentEnabled: false,
    })
    expect(runMocks.runPiSession).toHaveBeenCalledWith(
      expect.objectContaining({
        workingPath: '/repo/worktree',
        visualizationDirectory: '/visualizations/session-1',
        sessionsExtensionFactory: runMocks.sessionsExtensionFactory,
      }),
    )
    expect(prepareTurn).toHaveBeenCalledWith({
      sessionId: 'session-1',
      snapshot: expect.objectContaining({
        servers: [expect.objectContaining({ name: 'github' })],
      }),
    })
    expect(completeTurn).toHaveBeenCalledWith({
      sessionId: 'session-1',
      nextSnapshot: expect.objectContaining({
        servers: [expect.objectContaining({ name: 'github' })],
      }),
    })
  })

  it('injects the scoped Sessions extension into Waggle runs', async () => {
    runMocks.runPiWaggle.mockResolvedValue({
      newMessages: [],
      piSessionId: 'pi-session',
      sessionSnapshot: { nodes: [], activeNodeId: null },
    })
    const waggle = fromPartial<AgentKernelWaggleRunOptions>({
      inheritedModel: SupportedModelId('openai/gpt-5.4'),
      onWaggleEvent: vi.fn(),
      onTurnEvent: vi.fn(),
    })
    const input = fromPartial<AgentKernelRunInput>({
      session: { id: SessionId('session-waggle'), projectPath: '/repo' },
      runId: 'run-waggle',
      payload: { text: 'Coordinate workers', thinkingLevel: 'medium', attachments: [] },
      model: SupportedModelId('openai/gpt-5.4'),
      signal: new AbortController().signal,
      onEvent: vi.fn(),
      sessionCapabilities: ['sessions:spawn'],
      waggle,
    })
    const mcpConfig = fromPartial<McpConfigServiceShape>({
      createTurnSnapshot: () => Effect.succeed(null),
    })
    const mcpRuntime = fromPartial<McpRuntimeServiceShape>({
      prepareTurn: () => Effect.void,
      completeTurn: () => Effect.void,
      disposeSession: () => Effect.void,
    })
    const inlineVisualization = fromPartial<InlineVisualizationServiceShape>({
      prepareSession: () => Effect.succeed('/visualizations/session-waggle'),
    })

    await Effect.runPromise(
      runPiAgentKernel(input, {
        runtimeExtensionIsolation: {},
        terminal: fromPartial({}),
        browserPreviewAutomation: fromPartial({}),
        enableBrowserPreviewAutomation: false,
        mcpConfig,
        mcpRuntime,
        inlineVisualization,
      }),
    )

    expect(runMocks.runPiWaggle).toHaveBeenCalledWith(
      expect.objectContaining({
        waggle,
        workingPath: '/repo/worktree',
        visualizationDirectory: '/visualizations/session-waggle',
        sessionsExtensionFactory: runMocks.sessionsExtensionFactory,
      }),
    )
    expect(runMocks.runPiSession).not.toHaveBeenCalled()
  })
})
