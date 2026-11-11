import { mkdir, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import type { ToolDefinition } from '@earendil-works/pi-coding-agent'
import { SessionId, SupportedModelId } from '@shared/types/brand'
import { fromPartial } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentKernelWaggleRunOptions } from '../../../ports/agent-kernel-service'
import { runPiAgentKernel } from '../pi-agent-kernel-run'
import {
  EMPTY_RUN_RESULT,
  kernelRunDependencies,
  kernelRunInput,
} from './pi-agent-kernel-run.test-harness'

const runMocks = vi.hoisted(() => ({
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
vi.mock('../agent-kernel/session-worktree-birth', () => ({
  ensureSessionWorktreeProjectPath: async () => '/repo/worktree',
}))
vi.mock('../agent-kernel/waggle-run', () => ({ runPiWaggle: runMocks.runPiWaggle }))
vi.mock('../sessions-tool-extension', () => ({
  createSessionsToolExtension: runMocks.createSessionsToolExtension,
}))
vi.mock('../../git/remote-sync', () => ({
  pullCurrentBranchFastForward: runMocks.pullCurrentBranchFastForward,
  resolveTrackedBranch: runMocks.resolveTrackedBranch,
}))

describe('runPiAgentKernel', () => {
  beforeEach(() => {
    for (const mock of Object.values(runMocks)) mock.mockReset()
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
    runMocks.runPiSession.mockResolvedValue(EMPTY_RUN_RESULT)
    const input = kernelRunInput('session-1', {
      payload: { text: 'Coordinate workers', attachments: [] },
      sessionCapabilities: ['sessions:spawn', 'sessions:read'],
      modelMultiAgentEnabled: false,
    })

    await Effect.runPromise(
      runPiAgentKernel(input, kernelRunDependencies('/visualizations/session-1')),
    )

    expect(runMocks.createSessionsToolExtension).toHaveBeenCalledWith({
      sessionId: SessionId('session-1'),
      runId: 'run-1',
      workingDirectory: '/repo/worktree',
      projectPath: '/repo',
      sessionCapabilities: ['sessions:spawn', 'sessions:read'],
      modelMultiAgentEnabled: false,
      scratchDirectory: '/scratch/session-1',
    })
    expect(runMocks.runPiSession).toHaveBeenCalledWith(
      expect.objectContaining({
        workingPath: '/repo/worktree',
        visualizationDirectory: '/visualizations/session-1',
        scratchDirectory: '/scratch/session-1',
        sessionsExtensionFactory: runMocks.sessionsExtensionFactory,
      }),
    )
    const tools: Pick<ToolDefinition, 'name' | 'description'>[] = []
    const trusted: unknown = runMocks.runPiSession.mock.calls[0]?.[0]?.trustedExtensionFactories
    const pi = { registerTool: (tool: ToolDefinition) => tools.push(tool), on: () => undefined }
    for (const factory of Array.isArray(trusted) ? trusted : []) {
      if (typeof factory === 'function') factory(pi)
    }
    expect(tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining(['project_actions', 'source_control', 'openwaggle_docs']),
    )
    expect(tools.find(({ name }) => name === 'openwaggle_docs')?.description).toContain('/docs')
    // The Run holds its scratch directory until it ends, so an archive mid-Run cannot delete it.
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
    runMocks.runPiSession.mockResolvedValue(EMPTY_RUN_RESULT)
    const input = kernelRunInput('session-legacy', { mcpServerAllowlist: ['gh-1', 'lint'] })

    try {
      await Effect.runPromise(runPiAgentKernel(input, kernelRunDependencies(undefined)))
    } finally {
      await rm(recordPath, { force: true })
    }

    expect(runMocks.runPiSession).toHaveBeenCalledWith(
      expect.objectContaining({ mcpServerAllowlist: ['github', 'lint'] }),
    )
  })

  it('injects the scoped Sessions extension into Waggle runs', async () => {
    runMocks.runPiWaggle.mockResolvedValue(EMPTY_RUN_RESULT)
    const waggle = fromPartial<AgentKernelWaggleRunOptions>({
      inheritedModel: SupportedModelId('openai/gpt-5.4'),
      onWaggleEvent: vi.fn(),
      onTurnEvent: vi.fn(),
    })
    const input = kernelRunInput('session-waggle', {
      runId: 'run-waggle',
      sessionCapabilities: ['sessions:spawn'],
      waggle,
    })

    await Effect.runPromise(
      runPiAgentKernel(input, kernelRunDependencies('/visualizations/session-waggle')),
    )

    expect(runMocks.runPiWaggle).toHaveBeenCalledWith(
      expect.objectContaining({
        waggle,
        workingPath: '/repo/worktree',
        visualizationDirectory: '/visualizations/session-waggle',
        scratchDirectory: '/scratch/session-waggle',
        sessionsExtensionFactory: expect.any(Function),
      }),
    )
    expect(runMocks.runPiSession).not.toHaveBeenCalled()
  })
})
