import type { Message } from '@shared/types/agent'
import { SessionId, SupportedModelId } from '@shared/types/brand'
import { fromPartial } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentKernelRunInput } from '../../../ports/agent-kernel-service'
import { server, snapshot, waitingFor } from '../../mcp/__tests__/mcp-runtime-test-utils'
import { runPiAgentKernel } from '../pi-agent-kernel-run'

const runMocks = vi.hoisted(() => ({
  ensureSessionWorktreeProjectPath: vi.fn(async () => '/repo/worktree'),
  runPiSession: vi.fn(),
  runPiWaggle: vi.fn(),
  sessionsExtensionFactory: vi.fn(),
  createSessionsToolExtension: vi.fn(),
  pullCurrentBranchFastForward: vi.fn(
    async (_path: string, _options?: { readonly signal?: AbortSignal }) => ({
      ok: true,
      message: 'Pulled latest changes.',
    }),
  ),
  resolveTrackedBranch: vi.fn(async () => ({ branch: 'main', upstream: 'origin/main' })),
}))

vi.mock('../../../utils/session-scratch-directory', () => ({
  prepareSessionScratchDirectory: async (sessionId: string) => `/scratch/${sessionId}`,
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
  'projectActions' | 'preparation'
> {
  return {
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

describe('runPiAgentKernel launch steps', () => {
  beforeEach(() => {
    for (const mock of Object.values(runMocks)) mock.mockReset()
    runMocks.ensureSessionWorktreeProjectPath.mockResolvedValue('/repo/worktree')
    runMocks.createSessionsToolExtension.mockReturnValue(runMocks.sessionsExtensionFactory)
    runMocks.resolveTrackedBranch.mockResolvedValue({ branch: 'main', upstream: 'origin/main' })
    runMocks.pullCurrentBranchFastForward.mockResolvedValue({
      ok: true,
      message: 'Pulled latest changes.',
    })
  })

  it('pulls the checked-out branch before the first run of a local-mode conversation', async () => {
    runMocks.runPiSession.mockResolvedValue({
      newMessages: [],
      piSessionId: 'pi-session',
      sessionSnapshot: { nodes: [], activeNodeId: null },
    })
    const input = fromPartial<AgentKernelRunInput>({
      session: { id: SessionId('session-local'), projectPath: '/repo', messages: [] },
      runId: 'run-local',
      payload: { text: 'Do the work', thinkingLevel: 'medium', attachments: [] },
      model: SupportedModelId('openai/gpt-5.4'),
      signal: new AbortController().signal,
      onEvent: vi.fn(),
    })

    await Effect.runPromise(
      runPiAgentKernel(input, {
        runtimeExtensionIsolation: {},
        ...actionWorkspaceDependencies(),
        terminal: fromPartial({}),
        browserPreviewAutomation: fromPartial({}),
        enableBrowserPreviewAutomation: false,
        mcpConfig: fromPartial({ createTurnSnapshot: () => Effect.succeed(null) }),
        mcpRuntime: fromPartial({
          prepareTurn: () => Effect.void,
          completeTurn: () => Effect.void,
          disposeSession: () => Effect.void,
        }),
        inlineVisualization: fromPartial({
          prepareSession: () => Effect.succeed('/visualizations/session-local'),
        }),
      }),
    )

    expect(runMocks.pullCurrentBranchFastForward).toHaveBeenCalledWith(
      '/repo/worktree',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
  })

  it('reports a local first run step by step and syncs the branch while MCP connects', async () => {
    runMocks.runPiSession.mockResolvedValue({
      newMessages: [],
      piSessionId: 'pi-session',
      sessionSnapshot: { nodes: [], activeNodeId: null },
    })
    const pull = Promise.withResolvers<{ ok: boolean; message: string }>()
    runMocks.pullCurrentBranchFastForward.mockReturnValue(pull.promise)
    const onWorktreeLaunch = vi.fn()
    const prepareTurn = vi.fn(() => Effect.void)
    const turn = snapshot({
      servers: [
        server({ instanceId: 'docs-id', name: 'docs', definition: { command: 'docs' } }),
        server({
          instanceId: 'atlassian-id',
          name: 'atlassian',
          definition: { command: 'atlassian', directTools: true },
        }),
      ],
    })
    const input = fromPartial<AgentKernelRunInput>({
      session: { id: SessionId('session-local'), projectPath: '/repo', messages: [] },
      runId: 'run-local',
      payload: { text: 'Do the work', thinkingLevel: 'medium', attachments: [] },
      model: SupportedModelId('openai/gpt-5.4'),
      signal: new AbortController().signal,
      onEvent: vi.fn(),
      onWorktreeLaunch,
    })

    const running = Effect.runPromise(
      runPiAgentKernel(input, {
        runtimeExtensionIsolation: {},
        ...actionWorkspaceDependencies(),
        terminal: fromPartial({}),
        browserPreviewAutomation: fromPartial({}),
        enableBrowserPreviewAutomation: false,
        mcpConfig: fromPartial({ createTurnSnapshot: () => Effect.succeed(turn) }),
        mcpRuntime: fromPartial({
          prepareTurn,
          listDirectTools: waitingFor(['atlassian'], Effect.succeed([])),
          completeTurn: () => Effect.void,
          disposeSession: () => Effect.void,
        }),
        inlineVisualization: fromPartial({
          prepareSession: () => Effect.succeed('/visualizations/session-local'),
        }),
      }),
    )

    // MCP preparation starts while the pull is still waiting on the network.
    await vi.waitFor(() => expect(prepareTurn).toHaveBeenCalledOnce())
    expect(runMocks.runPiSession).not.toHaveBeenCalled()
    pull.resolve({ ok: true, message: 'Pulled latest changes.' })
    await running

    const reported = onWorktreeLaunch.mock.calls.map(([progress]) => progress)
    expect(reported).toEqual(
      expect.arrayContaining([
        {
          stage: 'syncing-branch',
          environment: 'local',
          parallel: true,
          label: 'Pulling latest changes for main',
          details: ['Pulling origin/main into main'],
        },
        {
          stage: 'connecting-tools',
          environment: 'local',
          parallel: true,
          label: 'Connecting MCP servers: atlassian',
          details: ['Connecting atlassian'],
        },
        { stage: 'connecting-tools', environment: 'local', completesStep: true, details: [] },
        { stage: 'syncing-branch', environment: 'local', completesStep: true, details: [] },
      ]),
    )
    // The pull finishes after MCP connected; the task starts only once both are done.
    expect(reported.at(-2)).toMatchObject({ stage: 'syncing-branch', completesStep: true })
    expect(reported.at(-1)).toEqual({
      stage: 'starting-task',
      environment: 'local',
      details: ['Starting the task'],
    })
  })

  it('reports no launch steps for a later local turn', async () => {
    runMocks.runPiSession.mockResolvedValue({
      newMessages: [],
      piSessionId: 'pi-session',
      sessionSnapshot: { nodes: [], activeNodeId: null },
    })
    const onWorktreeLaunch = vi.fn()
    const turn = snapshot({
      servers: [server({ name: 'atlassian', definition: { command: 'a', directTools: true } })],
    })
    await Effect.runPromise(
      runPiAgentKernel(
        fromPartial<AgentKernelRunInput>({
          session: {
            id: SessionId('session-local'),
            projectPath: '/repo',
            messages: [fromPartial<Message>({ id: 'm-1' })],
          },
          runId: 'run-later',
          payload: { text: 'More', thinkingLevel: 'medium', attachments: [] },
          model: SupportedModelId('openai/gpt-5.4'),
          signal: new AbortController().signal,
          onEvent: vi.fn(),
          onWorktreeLaunch,
        }),
        {
          runtimeExtensionIsolation: {},
          ...actionWorkspaceDependencies(),
          terminal: fromPartial({}),
          browserPreviewAutomation: fromPartial({}),
          enableBrowserPreviewAutomation: false,
          mcpConfig: fromPartial({ createTurnSnapshot: () => Effect.succeed(turn) }),
          mcpRuntime: fromPartial({
            prepareTurn: () => Effect.void,
            listDirectTools: () => Effect.succeed([]),
            completeTurn: () => Effect.void,
            disposeSession: () => Effect.void,
          }),
          inlineVisualization: fromPartial({ prepareSession: () => Effect.succeed(undefined) }),
        },
      ),
    )
    expect(onWorktreeLaunch).not.toHaveBeenCalled()
  })

  it('stops the pull, releases MCP, and reports nothing late when MCP fails mid-launch', async () => {
    const pull = Promise.withResolvers<{ ok: boolean; message: string }>()
    let pullSignal: AbortSignal | undefined
    runMocks.pullCurrentBranchFastForward.mockImplementation(
      (_path: string, options?: { readonly signal?: AbortSignal }) => {
        pullSignal = options?.signal
        return pull.promise
      },
    )
    const onWorktreeLaunch = vi.fn()
    const disposeSession = vi.fn(() => Effect.void)
    const turn = snapshot({
      servers: [server({ name: 'atlassian', definition: { command: 'a', directTools: true } })],
    })
    const exit = await Effect.runPromiseExit(
      runPiAgentKernel(
        fromPartial<AgentKernelRunInput>({
          session: { id: SessionId('session-local'), projectPath: '/repo', messages: [] },
          runId: 'run-failing',
          payload: { text: 'Do the work', thinkingLevel: 'medium', attachments: [] },
          model: SupportedModelId('openai/gpt-5.4'),
          signal: new AbortController().signal,
          onEvent: vi.fn(),
          onWorktreeLaunch,
        }),
        {
          runtimeExtensionIsolation: {},
          ...actionWorkspaceDependencies(),
          terminal: fromPartial({}),
          browserPreviewAutomation: fromPartial({}),
          enableBrowserPreviewAutomation: false,
          mcpConfig: fromPartial({ createTurnSnapshot: () => Effect.succeed(turn) }),
          mcpRuntime: fromPartial({
            prepareTurn: () => Effect.void,
            listDirectTools: waitingFor(
              ['atlassian'],
              Effect.fail(new Error('atlassian is unavailable')),
            ),
            completeTurn: () => Effect.void,
            disposeSession,
          }),
          inlineVisualization: fromPartial({ prepareSession: () => Effect.succeed(undefined) }),
        },
      ),
    )

    expect(exit._tag).toBe('Failure')
    expect(pullSignal?.aborted).toBe(true)
    expect(disposeSession).toHaveBeenCalled()
    pull.resolve({ ok: false, message: 'aborted' })
    await new Promise((resolve) => setTimeout(resolve, 0))
    const reported = onWorktreeLaunch.mock.calls.map(([progress]) => progress)
    // The failed MCP step stays open so the failure lands on it; nothing completes afterwards.
    expect(reported.filter((progress) => progress.completesStep)).toEqual([])
    expect(runMocks.runPiSession).not.toHaveBeenCalled()
  })
})
