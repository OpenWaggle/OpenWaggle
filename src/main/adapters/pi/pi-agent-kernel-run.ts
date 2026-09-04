import * as Effect from 'effect/Effect'
import { createLogger } from '../../logger'
import type {
  AgentKernelRunInput,
  AgentKernelWaggleRunOptions,
} from '../../ports/agent-kernel-service'
import type { InlineVisualizationServiceShape } from '../../ports/inline-visualization-service'
import type { McpConfigServiceShape } from '../../ports/mcp-config-service'
import type { McpRuntimeServiceShape } from '../../ports/mcp-runtime-service'
import { runPiSession } from './agent-kernel/classic-run'
import type { PiRuntimeExtensionIsolationInput } from './agent-kernel/runtime-extension-isolation'
import { requireSessionProjectPath } from './agent-kernel/session-manager'
import { ensureSessionWorktreeProjectPath } from './agent-kernel/session-worktree-birth'
import { runPiWaggle } from './agent-kernel/waggle-run'
import { createMcpGatewayExtension } from './mcp-gateway-extension'

const logger = createLogger('pi-agent-kernel')

function toAgentKernelError(error: unknown) {
  return error instanceof Error ? error : new Error(String(error))
}

function hasWaggleRunOptions(
  input: AgentKernelRunInput,
): input is AgentKernelRunInput & { readonly waggle: AgentKernelWaggleRunOptions } {
  return Boolean(input.waggle)
}

function resolveMcpTurnPaths(input: AgentKernelRunInput) {
  return Effect.gen(function* () {
    const projectPath = yield* Effect.try({
      try: () => requireSessionProjectPath(input.session),
      catch: toAgentKernelError,
    })
    const executionPath = yield* Effect.tryPromise({
      try: () =>
        ensureSessionWorktreeProjectPath(input.session, {
          ...(input.onWorktreeLaunch ? { onProgress: input.onWorktreeLaunch } : {}),
          signal: input.signal,
        }),
      catch: toAgentKernelError,
    })
    return { projectPath, executionPath }
  })
}

export function prepareMcpTurn(input: {
  readonly projectPath: string
  readonly executionPath: string
  readonly sessionId: string
  readonly config: McpConfigServiceShape
  readonly runtime: McpRuntimeServiceShape
}) {
  return Effect.gen(function* () {
    const snapshot = yield* input.config.createTurnSnapshot(input)
    yield* input.runtime.prepareTurn({ sessionId: input.sessionId, snapshot })
    return yield* Effect.gen(function* () {
      const directTools = snapshot ? yield* input.runtime.listDirectTools(snapshot) : []
      const extensionFactory = snapshot
        ? createMcpGatewayExtension({
            snapshot,
            directTools,
            executeGateway: (request, signal, interactions) =>
              Effect.runPromise(
                input.runtime.executeGateway({
                  snapshot,
                  request,
                  ...(signal ? { signal } : {}),
                  ...(interactions ? { interactions } : {}),
                }),
              ),
          })
        : undefined
      const finish = Effect.gen(function* () {
        const nextSnapshot = yield* input.config.createTurnSnapshot(input)
        yield* input.runtime.completeTurn({ sessionId: input.sessionId, nextSnapshot })
      }).pipe(Effect.catchAllCause(() => input.runtime.disposeSession(input.sessionId)))
      return { extensionFactory, finish }
    }).pipe(
      Effect.onError(() =>
        input.runtime.disposeSession(input.sessionId).pipe(Effect.catchAllCause(() => Effect.void)),
      ),
    )
  })
}

function createWorktreeLaunchReporter(input: AgentKernelRunInput) {
  let didReport = false
  const onWorktreeLaunch = input.onWorktreeLaunch
    ? (progress: Parameters<NonNullable<typeof input.onWorktreeLaunch>>[0]) => {
        didReport = true
        input.onWorktreeLaunch?.(progress)
      }
    : undefined
  return {
    runInput: onWorktreeLaunch ? { ...input, onWorktreeLaunch } : input,
    reportTaskStarting(executionPath: string) {
      if (!didReport) return
      onWorktreeLaunch?.({
        stage: 'starting-task',
        details: ['Starting the task in the new worktree'],
        worktreePath: executionPath,
      })
    },
  }
}

export function runPiAgentKernel(
  input: AgentKernelRunInput,
  dependencies: {
    readonly runtimeExtensionIsolation: PiRuntimeExtensionIsolationInput
    readonly mcpConfig: McpConfigServiceShape
    readonly mcpRuntime: McpRuntimeServiceShape
    readonly inlineVisualization: InlineVisualizationServiceShape
  },
) {
  return Effect.gen(function* () {
    const launchReporter = createWorktreeLaunchReporter(input)
    const { projectPath, executionPath } = yield* resolveMcpTurnPaths(launchReporter.runInput)
    const visualizationDirectory = yield* dependencies.inlineVisualization
      .prepareSession(input.session.id)
      .pipe(
        Effect.catchAll((error) =>
          Effect.sync(() => {
            logger.warn('Failed to prepare the session visualization directory', {
              sessionId: input.session.id,
              error: error.message,
            })
            return undefined
          }),
        ),
      )
    const mcpTurn = yield* prepareMcpTurn({
      projectPath,
      executionPath,
      sessionId: input.session.id,
      config: dependencies.mcpConfig,
      runtime: dependencies.mcpRuntime,
    })
    launchReporter.reportTaskStarting(executionPath)
    return yield* Effect.tryPromise({
      try: () =>
        hasWaggleRunOptions(input)
          ? runPiWaggle({
              ...input,
              ...dependencies.runtimeExtensionIsolation,
              workingPath: executionPath,
              ...(visualizationDirectory ? { visualizationDirectory } : {}),
              ...(mcpTurn.extensionFactory
                ? { mcpExtensionFactory: mcpTurn.extensionFactory }
                : {}),
            })
          : runPiSession({
              ...input,
              ...dependencies.runtimeExtensionIsolation,
              workingPath: executionPath,
              ...(visualizationDirectory ? { visualizationDirectory } : {}),
              ...(mcpTurn.extensionFactory
                ? { mcpExtensionFactory: mcpTurn.extensionFactory }
                : {}),
            }),
      catch: toAgentKernelError,
    }).pipe(Effect.ensuring(mcpTurn.finish))
  })
}
