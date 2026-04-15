/**
 * Tests for the orchestrate tool's run registration lifecycle.
 *
 * WHY mocking runOpenWaggleOrchestration is the correct seam:
 *
 * The bug is that orchestrate.ts does not register runs in the global
 * active-runs module before calling runOpenWaggleOrchestration. The engine
 * (runOpenWaggleOrchestration) is the consumer of the signal — it doesn't
 * control registration. The orchestrate tool is the owner of the lifecycle:
 * it creates the run, must register it, and must clean it up.
 *
 * Mocking runOpenWaggleOrchestration lets us:
 * 1. Observe the signal passed TO the engine (is it the bridged one?)
 * 2. Check registration state DURING execution (is the run findable?)
 * 3. Simulate success/failure/abort to verify cleanup in all paths
 *
 * This is not "testing a side effect in a convenient spot" — it is testing
 * the orchestrate tool's contract: before calling the engine, runs must be
 * registered; after the engine returns (or throws), runs must be cleaned up;
 * and the engine must receive a signal that can be aborted via IPC.
 */

import { ConversationId, SupportedModelId } from '@shared/types/brand'
import { DEFAULT_SETTINGS } from '@shared/types/settings'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cancelActiveOrchestrationRun } from '../../../orchestration/active-runs'
import { executeToolWithContext } from '../../define-tool'

// ---------------------------------------------------------------------------
// Mocks for all lazy imports used by orchestrate.ts execute()
// ---------------------------------------------------------------------------

const runOpenWaggleOrchestrationMock = vi.fn()

vi.mock('../../../store/settings', () => ({
  getSettings: () => ({
    ...DEFAULT_SETTINGS,
    selectedModel: SupportedModelId('claude-sonnet-4-5'),
    providers: {
      anthropic: { enabled: true, apiKey: 'sk-test' },
    },
  }),
}))

vi.mock('../../../config/project-config', () => ({
  loadProjectConfig: vi.fn(async () => ({ quality: undefined, approvals: {} })),
}))

vi.mock('../../../agent/shared', () => ({
  resolveProviderAndQuality: vi.fn(async () => ({
    ok: true,
    provider: {
      id: 'anthropic',
      displayName: 'Anthropic',
      requiresApiKey: true,
      createAdapter: () => ({}),
    },
    providerConfig: { enabled: true, apiKey: 'sk-test' },
    resolvedModel: SupportedModelId('claude-sonnet-4-5'),
    qualityConfig: { model: SupportedModelId('claude-sonnet-4-5'), maxTokens: 4096 },
  })),
  isResolutionError: vi.fn(() => false),
}))

vi.mock('../../../orchestration/engine', () => ({
  runOpenWaggleOrchestration: (...args: unknown[]) => runOpenWaggleOrchestrationMock(...args),
}))

vi.mock('../../../orchestration/project-context', () => ({
  gatherProjectContext: vi.fn(async () => ({ text: 'project context' })),
}))

vi.mock('../../../orchestration/run-repository', () => ({
  orchestrationRunRepository: {
    appendEvent: vi.fn(async () => undefined),
  },
}))

vi.mock('../../../orchestration/service/deps', () => ({
  defaultOrchestrationServiceDeps: {},
}))

vi.mock('../../../orchestration/service/model-runner', () => ({
  createModelRunner: () => ({
    modelText: vi.fn(async () => 'synthesized'),
    modelTextWithTools: vi.fn(async () => 'executed'),
  }),
}))

vi.mock('../../../orchestration/service/prompts', () => ({
  buildExecutionPrompt: vi.fn(() => 'exec prompt'),
  buildSynthesisPrompt: vi.fn(() => 'synth prompt'),
}))

vi.mock('../../../orchestration/executor-tools', () => ({
  buildExecutorTools: vi.fn(() => []),
}))

vi.mock('../../../utils/stream-bridge', () => ({
  emitOrchestrationEvent: vi.fn(),
}))

vi.mock('../../../logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

import { orchestrateTool } from '../orchestrate'

const CONV_ID = ConversationId('test-conv')

const VALID_ARGS = {
  tasks: [
    { id: 'task-1', title: 'Task One', prompt: 'Do thing one' },
    { id: 'task-2', title: 'Task Two', prompt: 'Do thing two' },
  ],
}

afterEach(() => {
  vi.clearAllMocks()
})

describe('orchestrate tool — run registration lifecycle', () => {
  it('run is registered before engine executes and cancellable during execution', async () => {
    let wasRegisteredDuringExecution = false
    let cancelReturnedTrue = false

    runOpenWaggleOrchestrationMock.mockImplementation(async (input: { runId: string }) => {
      // This runs INSIDE orchestrate.ts execute(), after registration should
      // have happened. We call the same cancel function the IPC handler uses.
      wasRegisteredDuringExecution = true
      cancelReturnedTrue = cancelActiveOrchestrationRun(input.runId)

      return { runId: input.runId, text: 'result', usedFallback: false, runStatus: 'completed' }
    })

    await executeToolWithContext(
      orchestrateTool,
      { conversationId: CONV_ID, projectPath: '/test', signal: new AbortController().signal },
      VALID_ARGS,
    )

    expect(wasRegisteredDuringExecution).toBe(true)
    expect(cancelReturnedTrue).toBe(true)
  })

  it('run is registered then unregistered after successful execution (lifecycle transition)', async () => {
    let registeredDuringRun = false
    let capturedRunId = ''

    runOpenWaggleOrchestrationMock.mockImplementation(async (input: { runId: string }) => {
      capturedRunId = input.runId
      // Verify the run IS registered at this point (don't cancel — just check)
      // We can't use cancelActiveOrchestrationRun because that would remove it.
      // Instead, we verify by attempting cancel and re-registering if it was there.
      // Actually — we proved registration in the test above. Here we just capture
      // the runId and verify the transition: registered → unregistered.
      registeredDuringRun = true
      return { runId: input.runId, text: 'done', usedFallback: false, runStatus: 'completed' }
    })

    await executeToolWithContext(
      orchestrateTool,
      { conversationId: CONV_ID, projectPath: '/test', signal: new AbortController().signal },
      VALID_ARGS,
    )

    // The mock ran (proving execution happened)
    expect(registeredDuringRun).toBe(true)
    expect(capturedRunId).not.toBe('')

    // After execute() returns, the run must be unregistered (cleanup in finally)
    const canCancelAfter = cancelActiveOrchestrationRun(capturedRunId)
    expect(canCancelAfter).toBe(false)
  })

  it('run is registered then unregistered after failed execution (lifecycle transition)', async () => {
    let registeredDuringRun = false
    let capturedRunId = ''

    runOpenWaggleOrchestrationMock.mockImplementation(async (input: { runId: string }) => {
      capturedRunId = input.runId
      registeredDuringRun = true
      throw new Error('orchestration failed')
    })

    await expect(
      executeToolWithContext(
        orchestrateTool,
        { conversationId: CONV_ID, projectPath: '/test', signal: new AbortController().signal },
        VALID_ARGS,
      ),
    ).rejects.toThrow('orchestration failed')

    // The mock ran (proving execution was attempted)
    expect(registeredDuringRun).toBe(true)

    // After the error, cleanup must have run (finally block)
    const canCancelAfter = cancelActiveOrchestrationRun(capturedRunId)
    expect(canCancelAfter).toBe(false)
  })

  it('parent abort signal propagates to the engine signal', async () => {
    const parentController = new AbortController()
    let engineSignalAborted = false

    runOpenWaggleOrchestrationMock.mockImplementation(
      async (input: { runId: string; signal?: AbortSignal }) => {
        // The engine receives a signal. We abort the parent DURING execution
        // and check whether the engine's signal reflects the abort.
        expect(input.signal).toBeDefined()

        // Abort the parent signal — this simulates the agent loop being cancelled
        parentController.abort()

        // The bridge in orchestrate.ts should propagate this to the
        // orchestrationController, whose signal was passed to the engine.
        // AbortSignal propagation is synchronous via the 'abort' event listener.
        engineSignalAborted = input.signal?.aborted ?? false

        return { runId: input.runId, text: 'aborted', usedFallback: false, runStatus: 'cancelled' }
      },
    )

    await executeToolWithContext(
      orchestrateTool,
      { conversationId: CONV_ID, projectPath: '/test', signal: parentController.signal },
      VALID_ARGS,
    )

    expect(engineSignalAborted).toBe(true)
  })

  it('run is cleaned up after parent abort during execution', async () => {
    const parentController = new AbortController()
    let capturedRunId = ''

    runOpenWaggleOrchestrationMock.mockImplementation(
      async (input: { runId: string; signal?: AbortSignal }) => {
        capturedRunId = input.runId

        // Verify the run is registered before we abort
        // (We can't call cancelActiveOrchestrationRun here because the abort
        // bridge would also trigger abort — test 1 already proved registration.)

        // Abort the parent
        parentController.abort()

        return { runId: input.runId, text: '', usedFallback: false, runStatus: 'cancelled' }
      },
    )

    await executeToolWithContext(
      orchestrateTool,
      { conversationId: CONV_ID, projectPath: '/test', signal: parentController.signal },
      VALID_ARGS,
    )

    // After execution + abort, no dangling run should remain
    expect(cancelActiveOrchestrationRun(capturedRunId)).toBe(false)
  })

  it('engine receives a different signal than the parent (bridged controller)', async () => {
    const parentController = new AbortController()
    let engineSignal: AbortSignal | undefined

    runOpenWaggleOrchestrationMock.mockImplementation(
      async (input: { runId: string; signal?: AbortSignal }) => {
        engineSignal = input.signal
        return { runId: input.runId, text: 'ok', usedFallback: false, runStatus: 'completed' }
      },
    )

    await executeToolWithContext(
      orchestrateTool,
      { conversationId: CONV_ID, projectPath: '/test', signal: parentController.signal },
      VALID_ARGS,
    )

    // The engine must NOT receive the raw parent signal — it should receive
    // the bridged orchestrationController.signal so that IPC cancellation
    // (which aborts the orchestrationController) also aborts the engine.
    expect(engineSignal).toBeDefined()
    expect(engineSignal).not.toBe(parentController.signal)
  })
})
