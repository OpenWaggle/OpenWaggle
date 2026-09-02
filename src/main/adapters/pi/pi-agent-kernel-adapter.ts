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
import { InlineVisualizationService } from '../../ports/inline-visualization-service'
import { McpConfigService } from '../../ports/mcp-config-service'
import { McpRuntimeService } from '../../ports/mcp-runtime-service'
import type { PiRuntimeExtensionIsolationInput } from './agent-kernel/runtime-extension-isolation'
import {
  compactPiSession,
  forkPiSession,
  getPiContextUsage,
  getPiSessionSnapshot,
  navigatePiSessionTree,
} from './agent-kernel/session-operations'
import { createPiSession } from './agent-kernel/session-runtime'
import {
  listRuntimeEnabledPackages,
  type OpenWagglePiExtensionSelectionServices,
} from './openwaggle-pi-extension-selection'
import { recordRuntimeLoadFailure } from './openwaggle-pi-runtime-failure-recording'
import { runPiAgentKernel } from './pi-agent-kernel-run'

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
  return Effect.gen(function* () {
    const enabledOpenWaggleExtensionPackages = yield* loadEnabledOpenWaggleExtensionPackages(
      input,
      extensionSelectionServices,
    )

    return {
      enabledOpenWaggleExtensionPackages,
      recordOpenWaggleExtensionRuntimeFailure: (selection, error, operation) =>
        recordRuntimeLoadFailure({
          selection,
          error,
          extensionSelectionServices,
          logger,
          operation,
        }),
    }
  })
}

export { prepareMcpTurn } from './pi-agent-kernel-run'

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
    const inlineVisualizationService = yield* InlineVisualizationService

    return AgentKernelService.of({
      createSession: (input) =>
        Effect.tryPromise({
          try: () => createPiSession(input.projectPath),
          catch: toAgentKernelError,
        }),

      run: (input: AgentKernelRunInput) =>
        Effect.gen(function* () {
          const runtimeExtensionIsolation = yield* loadPiRuntimeExtensionIsolationInput(
            input,
            extensionSelectionServices,
          )
          return yield* runPiAgentKernel(input, {
            runtimeExtensionIsolation,
            mcpConfig: mcpConfigService,
            mcpRuntime: mcpRuntimeService,
            inlineVisualization: inlineVisualizationService,
          })
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
