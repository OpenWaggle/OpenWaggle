import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import type {
  AgentKernelRunInput,
  AgentKernelWaggleRunOptions,
} from '../../ports/agent-kernel-service'
import type { BrowserPreviewAutomationServiceShape } from '../../ports/browser-preview-automation-service'
import type { InlineVisualizationServiceShape } from '../../ports/inline-visualization-service'
import type { McpConfigServiceShape } from '../../ports/mcp-config-service'
import type {
  McpDirectToolWaitOutcome,
  McpRuntimeServiceShape,
} from '../../ports/mcp-runtime-service'
import type { TerminalServiceShape } from '../../ports/terminal-service'
import type { WorkspacePreparationServiceShape } from '../../ports/workspace-preparation-service'
import { runPiSession } from './agent-kernel/classic-run'
import { restrictMcpSnapshot } from './agent-kernel/restricted-mcp-snapshot'
import type { PiRuntimeExtensionIsolationInput } from './agent-kernel/runtime-extension-isolation'
import { refreshFirstRunBranch } from './agent-kernel/session-branch-freshness'
import { runPiWaggle } from './agent-kernel/waggle-run'
import { createBrowserPreviewAutomationExtension } from './browser-preview-automation-extension'
import { BROWSER_PREVIEW_AUTOMATION_SYSTEM_PROMPT } from './browser-preview-automation-system-prompt'
import { createMcpGatewayExtension } from './mcp-gateway-extension'
import {
  createWorktreeLaunchReporter,
  prepareScratchDirectory,
  prepareVisualizationDirectory,
  withRetainedScratchDirectory,
} from './pi-agent-kernel-launch'
import { prepareActionWorkspace } from './prepare-action-workspace'
import {
  createProjectActionsToolExtension,
  type ProjectActionToolServices,
} from './project-actions-tool-extension'
import { createSessionsToolExtension } from './sessions-tool-extension'

export function createBrowserPreviewRuntimeResources(input: {
  readonly enabled: boolean
  readonly sessionId: AgentKernelRunInput['session']['id']
  readonly workingPath: string
  readonly service: BrowserPreviewAutomationServiceShape
}) {
  if (!input.enabled) {
    return { trustedExtensionFactories: [], systemPromptAppendices: [] } as const
  }
  return {
    trustedExtensionFactories: [
      createBrowserPreviewAutomationExtension({
        scope: { sessionId: input.sessionId, workingPath: input.workingPath },
        service: input.service,
      }),
    ],
    systemPromptAppendices: [BROWSER_PREVIEW_AUTOMATION_SYSTEM_PROMPT],
  } as const
}

function toAgentKernelError(error: unknown) {
  return error instanceof Error ? error : new Error(String(error))
}

function hasWaggleRunOptions(
  input: AgentKernelRunInput,
): input is AgentKernelRunInput & { readonly waggle: AgentKernelWaggleRunOptions } {
  return Boolean(input.waggle)
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
    ...(input.agentDefinitionToggles
      ? { agentDefinitionToggles: input.agentDefinitionToggles }
      : {}),
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
  /**
   * Called with the servers the turn waits for before Pi starts, when it waits for any: required
   * servers, and optional ones with no cached tool list during their short grace.
   */
  readonly onConnecting?: (serverNames: readonly string[]) => void
  /** Called once that wait is over. A failure leaves the step open so the error lands on it. */
  readonly onConnected?: (outcome: McpDirectToolWaitOutcome) => void
}) {
  return Effect.gen(function* () {
    const snapshot = restrictMcpSnapshot(
      yield* input.config.createTurnSnapshot(input),
      input.serverAllowlist,
    )
    yield* input.runtime.prepareTurn({ sessionId: input.sessionId, snapshot })
    return yield* Effect.gen(function* () {
      const directTools = snapshot
        ? yield* input.runtime.listDirectTools(snapshot, {
            ...(input.onConnecting ? { onWaiting: input.onConnecting } : {}),
            ...(input.onConnected ? { onWaitSettled: input.onConnected } : {}),
          })
        : []
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

export function runPiAgentKernel(
  input: AgentKernelRunInput,
  dependencies: {
    readonly preparation: WorkspacePreparationServiceShape
    readonly projectActions: ProjectActionToolServices
    readonly runtimeExtensionIsolation: PiRuntimeExtensionIsolationInput
    readonly mcpConfig: McpConfigServiceShape
    readonly mcpRuntime: McpRuntimeServiceShape
    readonly inlineVisualization: InlineVisualizationServiceShape
    readonly terminal: TerminalServiceShape
    readonly browserPreviewAutomation: BrowserPreviewAutomationServiceShape
    readonly enableBrowserPreviewAutomation: boolean
  },
) {
  return withRetainedScratchDirectory(input.session.id, runPiAgentKernelTurn(input, dependencies))
}

function runPiAgentKernelTurn(
  input: AgentKernelRunInput,
  dependencies: Parameters<typeof runPiAgentKernel>[1],
) {
  return Effect.gen(function* () {
    const launchReporter = createWorktreeLaunchReporter(input)
    const { projectPath, executionPath, preparedEnvironment } = yield* prepareActionWorkspace(
      launchReporter.runInput,
      { workspaces: dependencies.projectActions.workspaces, preparation: dependencies.preparation },
    )
    /*
     * The first-run branch sync and the MCP connections are both network waits, and running them
     * one after another made a first send wait for both. They are not fully independent: project
     * MCP config is read from the checkout being pulled, and stdio servers start in it. A first turn
     * can therefore use the pre-pull MCP config; the turn's `finish` re-reads it, so the next turn
     * reconnects with whatever the pull brought in.
     */
    let preparedMcpTurn: Effect.Effect.Success<ReturnType<typeof prepareMcpTurn>> | undefined
    const [, visualizationDirectory, scratchDirectory, mcpTurn] = yield* Effect.all(
      [
        refreshFirstRunBranch(input, executionPath, launchReporter.report),
        prepareVisualizationDirectory(dependencies.inlineVisualization, input.session.id),
        prepareScratchDirectory(input.session.id),
        prepareMcpTurn({
          projectPath,
          executionPath,
          sessionId: input.session.id,
          config: dependencies.mcpConfig,
          runtime: dependencies.mcpRuntime,
          ...(input.mcpServerAllowlist !== undefined
            ? { serverAllowlist: input.mcpServerAllowlist }
            : {}),
          onConnecting: launchReporter.reportConnectingTools,
          onConnected: launchReporter.reportToolsConnected,
        }).pipe(
          Effect.tap((turn) =>
            Effect.sync(() => {
              preparedMcpTurn = turn
            }),
          ),
        ),
      ],
      { concurrency: 'unbounded' },
    ).pipe(
      // A sibling can fail after MCP connected; release that turn, and drop late launch reports.
      Effect.onExit((exit) =>
        Exit.isSuccess(exit)
          ? Effect.void
          : Effect.suspend(() => {
              launchReporter.close()
              return preparedMcpTurn?.finish ?? Effect.void
            }),
      ),
    )
    const sessionsExtensionFactory = createRunSessionsExtension(input, executionPath, projectPath)
    const extensionFactories = mcpTurn.extensionFactory ? [mcpTurn.extensionFactory] : []
    const browserPreviewResources = createBrowserPreviewRuntimeResources({
      enabled: dependencies.enableBrowserPreviewAutomation,
      sessionId: input.session.id,
      workingPath: executionPath,
      service: dependencies.browserPreviewAutomation,
    })
    const trustedExtensionFactories = [
      ...browserPreviewResources.trustedExtensionFactories,
      createProjectActionsToolExtension({
        ...dependencies.projectActions,
        sessionId: input.session.id,
        runId: input.runId,
      }),
    ]
    launchReporter.reportTaskStarting(executionPath)
    return yield* Effect.tryPromise({
      try: () =>
        hasWaggleRunOptions(input)
          ? runPiWaggle({
              ...input,
              ...dependencies.runtimeExtensionIsolation,
              workingPath: executionPath,
              preparedEnvironment,
              sessionsExtensionFactory,
              ...(visualizationDirectory ? { visualizationDirectory } : {}),
              ...(scratchDirectory ? { scratchDirectory } : {}),
              extensionFactories,
              ...browserPreviewResources,
              trustedExtensionFactories,
            })
          : runPiSession({
              ...input,
              ...dependencies.runtimeExtensionIsolation,
              workingPath: executionPath,
              preparedEnvironment,
              sessionsExtensionFactory,
              ...(visualizationDirectory ? { visualizationDirectory } : {}),
              ...(scratchDirectory ? { scratchDirectory } : {}),
              extensionFactories,
              ...browserPreviewResources,
              trustedExtensionFactories,
            }),
      catch: toAgentKernelError,
    }).pipe(Effect.ensuring(mcpTurn.finish))
  })
}
