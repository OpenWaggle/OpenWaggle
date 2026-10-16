import { mkdir, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import type { ToolDefinition } from '@earendil-works/pi-coding-agent'
import type { Message } from '@shared/types/agent'
import { SessionId, SupportedModelId } from '@shared/types/brand'
import { fromPartial } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  AgentKernelRunInput,
  AgentKernelWaggleRunOptions,
} from '../../../ports/agent-kernel-service'
import type { InlineVisualizationServiceShape } from '../../../ports/inline-visualization-service'
import { McpSessionConnectionPool } from '../../mcp/pool/mcp-session-connection-pool'
import { runPiAgentKernel } from '../pi-agent-kernel-run'
import { stubDocsToolServices } from './openwaggle-docs-tool.test-harness'

const runMocks = vi.hoisted(() => ({
  ensureSessionWorktreeProjectPath: vi.fn(async () => '/repo/worktree'),
  runPiSession: vi.fn(),
  runPiWaggle: vi.fn(),
  sessionsExtensionFactory: vi.fn(),
  createSessionsToolExtension: vi.fn(),
  pullCurrentBranchFastForward: vi.fn(async () => ({
    ok: true,
    message: 'Pulled latest changes.',
  })),
  resolveTrackedBranch: vi.fn(async () => ({ branch: 'main', upstream: 'origin/main' })),
  prepareSessionScratchDirectory: vi.fn(async (sessionId: string) => `/scratch/${sessionId}`),
  retainSessionScratchDirectory: vi.fn(),
  releaseScratchDirectory: vi.fn(async () => undefined),
}))

vi.mock('../../../utils/session-scratch-directory', () => ({
  prepareSessionScratchDirectory: runMocks.prepareSessionScratchDirectory,
  retainSessionScratchDirectory: runMocks.retainSessionScratchDirectory,
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
vi.mock('../../git/remote-sync', () => ({
  pullCurrentBranchFastForward: runMocks.pullCurrentBranchFastForward,
  resolveTrackedBranch: runMocks.resolveTrackedBranch,
}))

function actionWorkspaceDependencies(): Pick<
  Parameters<typeof runPiAgentKernel>[1],
  'projectActions' | 'preparation' | 'docs'
> {
  return {
    docs: stubDocsToolServices('/docs-bundle'),
    projectActions: fromPartial({
      workspaces: {
        getBound: () =>
          Effect.succeed({
            id: 'workspace-1',
            projectPath: '/repo',
            workingPath: '/repo/worktree',
            kind: 'managed-worktree',
            worktreeBranch: 'test',
          }),
      },
    }),
    preparation: fromPartial({
      read: () => Effect.succeed(null),
      environment: () => Effect.succeed({}),
      requireSetup: () => Effect.void,
    }),
  }
}

describe('runPiAgentKernel', () => {
  beforeEach(() => {
    for (const mock of Object.values(runMocks)) mock.mockReset()
    runMocks.ensureSessionWorktreeProjectPath.mockResolvedValue('/repo/worktree')
    runMocks.createSessionsToolExtension.mockReturnValue(runMocks.sessionsExtensionFactory)
    runMocks.prepareSessionScratchDirectory.mockImplementation(
      async (sessionId: string) => `/scratch/${sessionId}`,
    )
    runMocks.releaseScratchDirectory.mockResolvedValue(undefined)
    runMocks.retainSessionScratchDirectory.mockReturnValue(runMocks.releaseScratchDirectory)
    runMocks.resolveTrackedBranch.mockResolvedValue({ branch: 'main', upstream: 'origin/main' })
    runMocks.pullCurrentBranchFastForward.mockResolvedValue({
      ok: true,
      message: 'Pulled latest changes.',
    })
  })

  it('injects the scoped Sessions extension and preserves visualization restrictions', async () => {
    runMocks.runPiSession.mockResolvedValue({
      newMessages: [],
      piSessionId: 'pi-session',
      sessionSnapshot: { nodes: [], activeNodeId: null },
    })

    const input = fromPartial<AgentKernelRunInput>({
      session: {
        id: SessionId('session-1'),
        projectPath: '/repo',
        messages: [],
      },
      runId: 'run-1',
      payload: { text: 'Coordinate workers', attachments: [] },
      model: SupportedModelId('openai/gpt-5.4'),
      signal: new AbortController().signal,
      onEvent: vi.fn(),
      sessionCapabilities: ['sessions:spawn', 'sessions:read'],
      modelMultiAgentEnabled: false,
    })
    const inlineVisualization = fromPartial<InlineVisualizationServiceShape>({
      prepareSession: () => Effect.succeed('/visualizations/session-1'),
    })

    await Effect.runPromise(
      runPiAgentKernel(input, {
        runtimeExtensionIsolation: {},
        mcpPool: new McpSessionConnectionPool(),
        ...actionWorkspaceDependencies(),
        terminal: fromPartial({}),
        browserPreviewAutomation: fromPartial({}),
        enableBrowserPreviewAutomation: false,
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
        scratchDirectory: '/scratch/session-1',
        sessionsExtensionFactory: runMocks.sessionsExtensionFactory,
      }),
    )
    // The Run holds its scratch directory until it ends, so an archive mid-Run cannot delete it.
    const tools: Pick<ToolDefinition, 'name' | 'promptGuidelines'>[] = []
    const trusted: unknown = runMocks.runPiSession.mock.calls[0]?.[0]?.trustedExtensionFactories
    for (const factory of Array.isArray(trusted) ? trusted : []) {
      if (typeof factory === 'function')
        factory({ registerTool: (tool: ToolDefinition) => tools.push(tool) })
    }
    expect(tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining(['project_actions', 'source_control', 'openwaggle_docs']),
    )
    const docs = tools.find((tool) => tool.name === 'openwaggle_docs')
    expect(docs?.promptGuidelines?.join('\n')).toContain('"/docs-bundle"')
    expect(runMocks.retainSessionScratchDirectory).toHaveBeenCalledWith('session-1')
    expect(runMocks.releaseScratchDirectory).toHaveBeenCalledTimes(1)
    expect(runMocks.releaseScratchDirectory.mock.invocationCallOrder[0]).toBeGreaterThan(
      runMocks.runPiSession.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    )
  })

  it('gives the Run server names for old MCP instance IDs in its allowlist', async () => {
    const recordPath = path.join(homedir(), '.openwaggle', 'mcp', 'migration.json')
    await mkdir(path.dirname(recordPath), { recursive: true })
    await writeFile(
      recordPath,
      JSON.stringify({ version: 1, files: {}, legacyServerNames: { 'gh-1': 'github' } }),
    )
    runMocks.runPiSession.mockResolvedValue({
      newMessages: [],
      piSessionId: 'pi-session',
      sessionSnapshot: { nodes: [], activeNodeId: null },
    })
    const input = fromPartial<AgentKernelRunInput>({
      session: { id: SessionId('session-legacy'), projectPath: '/repo', messages: [] },
      runId: 'run-1',
      payload: { text: 'Hi', attachments: [] },
      model: SupportedModelId('openai/gpt-5.4'),
      signal: new AbortController().signal,
      onEvent: vi.fn(),
      mcpServerAllowlist: ['gh-1', 'lint'],
    })

    try {
      await Effect.runPromise(
        runPiAgentKernel(input, {
          runtimeExtensionIsolation: {},
          mcpPool: new McpSessionConnectionPool(),
          ...actionWorkspaceDependencies(),
          terminal: fromPartial({}),
          browserPreviewAutomation: fromPartial({}),
          enableBrowserPreviewAutomation: false,
          inlineVisualization: fromPartial({ prepareSession: () => Effect.succeed(undefined) }),
        }),
      )
    } finally {
      await rm(recordPath, { force: true })
    }

    expect(runMocks.runPiSession).toHaveBeenCalledWith(
      expect.objectContaining({ mcpServerAllowlist: ['github', 'lint'] }),
    )
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
      session: { id: SessionId('session-waggle'), projectPath: '/repo', messages: [] },
      runId: 'run-waggle',
      payload: { text: 'Coordinate workers', attachments: [] },
      model: SupportedModelId('openai/gpt-5.4'),
      signal: new AbortController().signal,
      onEvent: vi.fn(),
      sessionCapabilities: ['sessions:spawn'],
      waggle,
    })
    const inlineVisualization = fromPartial<InlineVisualizationServiceShape>({
      prepareSession: () => Effect.succeed('/visualizations/session-waggle'),
    })

    await Effect.runPromise(
      runPiAgentKernel(input, {
        runtimeExtensionIsolation: {},
        mcpPool: new McpSessionConnectionPool(),
        ...actionWorkspaceDependencies(),
        terminal: fromPartial({}),
        browserPreviewAutomation: fromPartial({}),
        enableBrowserPreviewAutomation: false,
        inlineVisualization,
      }),
    )

    expect(runMocks.runPiWaggle).toHaveBeenCalledWith(
      expect.objectContaining({
        waggle,
        workingPath: '/repo/worktree',
        visualizationDirectory: '/visualizations/session-waggle',
        scratchDirectory: '/scratch/session-waggle',
        sessionsExtensionFactory: runMocks.sessionsExtensionFactory,
      }),
    )
    expect(runMocks.runPiSession).not.toHaveBeenCalled()
  })

  it('does not pull for worktree-mode sessions or later runs', async () => {
    runMocks.runPiSession.mockResolvedValue({
      newMessages: [],
      piSessionId: 'pi-session',
      sessionSnapshot: { nodes: [], activeNodeId: null },
    })
    const baseInput = {
      runId: 'run-again',
      payload: { text: 'Continue', thinkingLevel: 'medium' as const, attachments: [] },
      model: SupportedModelId('openai/gpt-5.4'),
      signal: new AbortController().signal,
      onEvent: vi.fn(),
    }
    const dependencies: Parameters<typeof runPiAgentKernel>[1] = {
      runtimeExtensionIsolation: {},
      mcpPool: new McpSessionConnectionPool(),
      ...actionWorkspaceDependencies(),
      terminal: fromPartial({}),
      browserPreviewAutomation: fromPartial({}),
      enableBrowserPreviewAutomation: false,
      inlineVisualization: fromPartial({
        prepareSession: () => Effect.succeed('/visualizations/session'),
      }),
    }

    await Effect.runPromise(
      runPiAgentKernel(
        fromPartial<AgentKernelRunInput>({
          ...baseInput,
          session: {
            id: SessionId('session-worktree'),
            projectPath: '/repo',
            messages: [],
            environmentMode: 'worktree' as const,
          },
        }),
        dependencies,
      ),
    )
    await Effect.runPromise(
      runPiAgentKernel(
        fromPartial<AgentKernelRunInput>({
          ...baseInput,
          session: {
            id: SessionId('session-second'),
            projectPath: '/repo',
            messages: [fromPartial<Message>({ id: 'm1' })],
          },
        }),
        dependencies,
      ),
    )

    expect(runMocks.pullCurrentBranchFastForward).not.toHaveBeenCalled()
  })
})
