import { Layer } from 'effect'
import * as Effect from 'effect/Effect'
import { createLogger } from '../../logger'
import {
  type AgentKernelRunInput,
  AgentKernelService,
  type AgentKernelSessionInput,
  type CompactAgentKernelSessionInput,
  type ForkAgentKernelSessionInput,
  type NavigateAgentKernelSessionInput,
} from '../../ports/agent-kernel-service'
import { ExtensionLifecycleRepository } from '../../ports/extension-lifecycle-repository'
import { ExtensionManagerService } from '../../ports/extension-manager-service'
import { ExtensionProjectOverridesRepository } from '../../ports/extension-project-overrides-repository'
import { McpConfigService, type McpConfigServiceShape } from '../../ports/mcp-config-service'
import { McpRuntimeService, type McpRuntimeServiceShape } from '../../ports/mcp-runtime-service'
import { runPiSession } from './agent-kernel/classic-run'
import { restrictMcpSnapshot } from './agent-kernel/restricted-mcp-snapshot'
import type { PiRuntimeExtensionIsolationInput } from './agent-kernel/runtime-extension-isolation'
import { requireSessionProjectPath } from './agent-kernel/session-manager'
import {
  compactPiSession,
  forkPiSession,
  getPiContextUsage,
  getPiSessionSnapshot,
  navigatePiSessionTree,
} from './agent-kernel/session-operations'
import { createPiSession } from './agent-kernel/session-runtime'
import { ensureSessionWorktreeProjectPath } from './agent-kernel/session-worktree-birth'
import { runPiWaggle } from './agent-kernel/waggle-run'
import { createMcpGatewayExtension } from './mcp-gateway-extension'
import {
  listRuntimeEnabledPackages,
  type OpenWagglePiExtensionSelectionServices,
} from './openwaggle-pi-extension-selection'
import { recordRuntimeLoadFailure } from './openwaggle-pi-runtime-failure-recording'
import { createSessionsToolExtension } from './sessions-tool-extension'

const logger = createLogger('pi-agent-kernel')

function toAgentKernelError(error: unknown) {
  return error instanceof Error ? error : new Error(String(error))
}

function loadEnabledOpenWaggleExtensionPackages(
  input: AgentKernelSessionInput,
  extensionSelectionServices: OpenWagglePiExtensionSelectionServices,
) {
  return input.session.projectPath
    ? listRuntimeEnabledPackages(input.session.projectPath, extensionSelectionServices).pipe(
        Effect.catchAll((error) =>
          Effect.sync(() => {
            logger.warn('Failed to resolve OpenWaggle extension runtime packages', {
              projectPath: input.session.projectPath,
              error: error instanceof Error ? error.message : String(error),
            })
            return []
          }),
        ),
      )
    : Effect.succeed([])
}

function loadPiRuntimeExtensionIsolationInput(
  input: AgentKernelSessionInput,
  extensionSelectionServices: OpenWagglePiExtensionSelectionServices,
): Effect.Effect<PiRuntimeExtensionIsolationInput> {
  return loadEnabledOpenWaggleExtensionPackages(input, extensionSelectionServices).pipe(
    Effect.map((enabledOpenWaggleExtensionPackages) => ({
      enabledOpenWaggleExtensionPackages,
      recordOpenWaggleExtensionRuntimeFailure: (selection, error, operation) =>
        recordRuntimeLoadFailure({
          selection,
          error,
          extensionSelectionServices,
          logger,
          operation,
        }),
    })),
  )
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

function createRunSessionsExtension(
  input: AgentKernelRunInput,
  workingDirectory: string,
  projectPath: string,
) {
  return createSessionsToolExtension({
    sessionId: input.session.id,
    runId: input.runId,
    workingDirectory,
    projectPath,
    ...(input.sessionCapabilities ? { sessionCapabilities: input.sessionCapabilities } : {}),
    ...(input.modelMultiAgentEnabled !== undefined
      ? { modelMultiAgentEnabled: input.modelMultiAgentEnabled }
      : {}),
  })
}

export function prepareMcpTurn(input: {
  readonly projectPath: string
  readonly executionPath: string
  readonly sessionId: string
  readonly config: McpConfigServiceShape
  readonly runtime: McpRuntimeServiceShape
  readonly serverAllowlist?: readonly string[]
}) {
  return Effect.gen(function* () {
    const snapshot = restrictMcpSnapshot(
      yield* input.config.createTurnSnapshot(input),
      input.serverAllowlist,
    )
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
        const nextSnapshot = restrictMcpSnapshot(
          yield* input.config.createTurnSnapshot(input),
          input.serverAllowlist,
        )
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

export const PiAgentKernelLive = Layer.effect(
  AgentKernelService,
  Effect.gen(function* () {
    const extensionSelectionServices = {
      manager: yield* ExtensionManagerService,
      lifecycleRepository: yield* ExtensionLifecycleRepository,
      projectOverridesRepository: yield* ExtensionProjectOverridesRepository,
    } satisfies OpenWagglePiExtensionSelectionServices
    const mcpConfigService = yield* McpConfigService
    const mcpRuntimeService = yield* McpRuntimeService

    return AgentKernelService.of({
      createSession: (input) =>
        Effect.tryPromise({
          try: () => createPiSession(input.projectPath),
          catch: toAgentKernelError,
        }),

      run: (input: AgentKernelRunInput) =>
        Effect.gen(function* () {
          const launchReporter = createWorktreeLaunchReporter(input)
          const runtimeExtensionIsolation = yield* loadPiRuntimeExtensionIsolationInput(
            input,
            extensionSelectionServices,
          )
          const { projectPath, executionPath } = yield* resolveMcpTurnPaths(launchReporter.runInput)
          const mcpTurn = yield* prepareMcpTurn({
            projectPath,
            executionPath,
            sessionId: input.session.id,
            config: mcpConfigService,
            runtime: mcpRuntimeService,
            ...(input.mcpServerAllowlist !== undefined
              ? { serverAllowlist: input.mcpServerAllowlist }
              : {}),
          })
          const sessionsExtensionFactory = createRunSessionsExtension(
            input,
            executionPath,
            projectPath,
          )
          launchReporter.reportTaskStarting(executionPath)
          return yield* Effect.tryPromise({
            try: () =>
              input.waggle
                ? runPiWaggle({
                    ...input,
                    waggle: input.waggle,
                    ...runtimeExtensionIsolation,
                    workingPath: executionPath,
                    sessionsExtensionFactory,
                    ...(mcpTurn.extensionFactory
                      ? { mcpExtensionFactory: mcpTurn.extensionFactory }
                      : {}),
                  })
                : runPiSession({
                    ...input,
                    ...runtimeExtensionIsolation,
                    workingPath: executionPath,
                    sessionsExtensionFactory,
                    ...(mcpTurn.extensionFactory
                      ? { mcpExtensionFactory: mcpTurn.extensionFactory }
                      : {}),
                  }),
            catch: toAgentKernelError,
          }).pipe(Effect.ensuring(mcpTurn.finish))
        }),

      getContextUsage: (input: AgentKernelSessionInput) =>
        Effect.gen(function* () {
          const runtimeExtensionIsolation = yield* loadPiRuntimeExtensionIsolationInput(
            input,
            extensionSelectionServices,
          )

          return yield* Effect.tryPromise({
            try: () => getPiContextUsage({ ...input, ...runtimeExtensionIsolation }),
            catch: toAgentKernelError,
          })
        }),

      getSessionSnapshot: (input: AgentKernelSessionInput) =>
        Effect.gen(function* () {
          const runtimeExtensionIsolation = yield* loadPiRuntimeExtensionIsolationInput(
            input,
            extensionSelectionServices,
          )

          return yield* Effect.tryPromise({
            try: () => getPiSessionSnapshot({ ...input, ...runtimeExtensionIsolation }),
            catch: toAgentKernelError,
          })
        }),

      compact: (input: CompactAgentKernelSessionInput) =>
        Effect.gen(function* () {
          const runtimeExtensionIsolation = yield* loadPiRuntimeExtensionIsolationInput(
            input,
            extensionSelectionServices,
          )

          return yield* Effect.tryPromise({
            try: () => compactPiSession({ ...input, ...runtimeExtensionIsolation }),
            catch: toAgentKernelError,
          })
        }),

      navigateTree: (input: NavigateAgentKernelSessionInput) =>
        Effect.gen(function* () {
          const runtimeExtensionIsolation = yield* loadPiRuntimeExtensionIsolationInput(
            input,
            extensionSelectionServices,
          )

          return yield* Effect.tryPromise({
            try: () => navigatePiSessionTree({ ...input, ...runtimeExtensionIsolation }),
            catch: toAgentKernelError,
          })
        }),

      forkSession: (input: ForkAgentKernelSessionInput) =>
        Effect.gen(function* () {
          const runtimeExtensionIsolation = yield* loadPiRuntimeExtensionIsolationInput(
            input,
            extensionSelectionServices,
          )

          return yield* Effect.tryPromise({
            try: () => forkPiSession({ ...input, ...runtimeExtensionIsolation }),
            catch: toAgentKernelError,
          })
        }),
    })
  }),
)
