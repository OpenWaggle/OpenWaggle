import { Layer } from 'effect'
import * as Effect from 'effect/Effect'
import { createLogger } from '../../logger'
import {
  type AgentKernelRunInput,
  AgentKernelService,
  type AgentKernelSessionInput,
  type AgentKernelWaggleRunOptions,
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

const logger = createLogger('pi-agent-kernel')

function toAgentKernelError(error: unknown) {
  return error instanceof Error ? error : new Error(String(error))
}

function hasWaggleRunOptions(
  input: AgentKernelRunInput,
): input is AgentKernelRunInput & { readonly waggle: AgentKernelWaggleRunOptions } {
  return Boolean(input.waggle)
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

/**
 * The two paths an MCP turn needs, which are not the same path for a worktree-mode session.
 *
 * `executionPath` is the tree the agent actually edits - the Session worktree in worktree
 * mode. It becomes the MCP sandbox cwd and its read/write roots, so passing the opened
 * checkout would let an MCP filesystem or git server act on the user's own checkout while
 * the agent worked in the worktree: the "surface targets the wrong tree" defect ADR 0018
 * exists to prevent. On main these were always identical because main had no worktree-mode
 * agent cwd, so the divergence only appears once both sides are combined.
 *
 * Worktree birth is *ensured* here rather than merely resolved, so the paths also agree on
 * the first send, before the tree exists. This is the same call the run functions make
 * immediately afterwards; it is in-flight deduplicated per session and returns early once
 * the tree exists, so hoisting it costs nothing.
 *
 * `projectPath` stays the opened checkout: MCP config discovery, scope and trust state are
 * keyed to the project the user opened, and a linked worktree must not fork that identity.
 */
function resolveMcpTurnPaths(session: AgentKernelRunInput['session']) {
  return Effect.gen(function* () {
    const projectPath = yield* Effect.try({
      try: () => requireSessionProjectPath(session),
      catch: toAgentKernelError,
    })
    const executionPath = yield* Effect.tryPromise({
      try: () => ensureSessionWorktreeProjectPath(session),
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
          const runtimeExtensionIsolation = yield* loadPiRuntimeExtensionIsolationInput(
            input,
            extensionSelectionServices,
          )
          const { projectPath, executionPath } = yield* resolveMcpTurnPaths(input.session)
          const mcpTurn = yield* prepareMcpTurn({
            projectPath,
            executionPath,
            sessionId: input.session.id,
            config: mcpConfigService,
            runtime: mcpRuntimeService,
          })
          return yield* Effect.tryPromise({
            try: () =>
              hasWaggleRunOptions(input)
                ? runPiWaggle({
                    ...input,
                    ...runtimeExtensionIsolation,
                    ...(mcpTurn.extensionFactory
                      ? { mcpExtensionFactory: mcpTurn.extensionFactory }
                      : {}),
                  })
                : runPiSession({
                    ...input,
                    ...runtimeExtensionIsolation,
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
