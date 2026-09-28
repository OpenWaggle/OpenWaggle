import type {
  WorktreeLaunchEnvironment,
  WorktreeLaunchProgress,
} from '@shared/types/background-run'
import * as Effect from 'effect/Effect'
import { serversConnectedBeforeTurn } from '../../domain/mcp/direct-tool-servers'
import { createLogger } from '../../logger'
import type {
  AgentKernelRunInput,
  AgentKernelWaggleRunOptions,
} from '../../ports/agent-kernel-service'
import type { BrowserPreviewAutomationServiceShape } from '../../ports/browser-preview-automation-service'
import type { InlineVisualizationServiceShape } from '../../ports/inline-visualization-service'
import type { McpConfigServiceShape } from '../../ports/mcp-config-service'
import type { McpRuntimeServiceShape } from '../../ports/mcp-runtime-service'
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
import { prepareActionWorkspace } from './prepare-action-workspace'
import {
  createProjectActionsToolExtension,
  type ProjectActionToolServices,
} from './project-actions-tool-extension'
import { createSessionsToolExtension } from './sessions-tool-extension'

const logger = createLogger('pi-agent-kernel')

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
  /** Called with the servers the turn connects before Pi starts, when there are any. */
  readonly onConnecting?: (serverNames: readonly string[]) => void
  /** Called once those servers answered, or failed to. */
  readonly onConnected?: () => void
}) {
  return Effect.gen(function* () {
    const snapshot = restrictMcpSnapshot(
      yield* input.config.createTurnSnapshot(input),
      input.serverAllowlist,
    )
    const connectedFirst = serversConnectedBeforeTurn(snapshot).map((server) => server.name)
    if (connectedFirst.length > 0) input.onConnecting?.(connectedFirst)
    yield* input.runtime.prepareTurn({ sessionId: input.sessionId, snapshot })
    return yield* Effect.gen(function* () {
      const directTools = snapshot
        ? yield* input.runtime
            .listDirectTools(snapshot)
            .pipe(
              Effect.ensuring(
                Effect.sync(() => (connectedFirst.length > 0 ? input.onConnected?.() : undefined)),
              ),
            )
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

/**
 * Reports what a run does before Pi starts, so a first send is never silent.
 *
 * Steps are reported for a Session's first run, and for any later run that had to prepare its
 * worktree. An ordinary later turn reports nothing: its transcript already shows the run, and a
 * launch card on every turn flashed the transcript and the sidebar status.
 */
function createWorktreeLaunchReporter(input: AgentKernelRunInput) {
  let didReport = false
  const environment: WorktreeLaunchEnvironment =
    input.session.environmentMode === 'worktree' ? 'worktree' : 'local'
  const firstRun = input.session.messages.length === 0
  let reportedTools = false
  const onWorktreeLaunch = input.onWorktreeLaunch
    ? (progress: WorktreeLaunchProgress) => {
        didReport = true
        input.onWorktreeLaunch?.({ ...progress, environment: progress.environment ?? environment })
      }
    : undefined
  return {
    runInput: onWorktreeLaunch ? { ...input, onWorktreeLaunch } : input,
    report: onWorktreeLaunch,
    reportConnectingTools(serverNames: readonly string[]) {
      if (!firstRun && !didReport) return
      reportedTools = true
      onWorktreeLaunch?.({
        stage: 'connecting-tools',
        parallel: true,
        label: `Connecting MCP servers: ${serverNames.join(', ')}`,
        details: [`Connecting ${serverNames.join(', ')}`],
      })
    },
    reportToolsConnected() {
      if (!reportedTools) return
      onWorktreeLaunch?.({ stage: 'connecting-tools', completesStep: true, details: [] })
    },
    reportTaskStarting(executionPath: string) {
      if (!didReport) return
      onWorktreeLaunch?.({
        stage: 'starting-task',
        details: [
          environment === 'worktree'
            ? 'Starting the task in the new worktree'
            : 'Starting the task',
        ],
        ...(environment === 'worktree' ? { worktreePath: executionPath } : {}),
      })
    },
  }
}

function prepareVisualizationDirectory(
  service: InlineVisualizationServiceShape,
  sessionId: AgentKernelRunInput['session']['id'],
) {
  return service.prepareSession(sessionId).pipe(
    Effect.catchAll((error) =>
      Effect.sync(() => {
        logger.warn('Failed to prepare the session visualization directory', {
          sessionId,
          error: error.message,
        })
        return undefined
      }),
    ),
  )
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
  return Effect.gen(function* () {
    const launchReporter = createWorktreeLaunchReporter(input)
    const { projectPath, executionPath, preparedEnvironment } = yield* prepareActionWorkspace(
      launchReporter.runInput,
      { workspaces: dependencies.projectActions.workspaces, preparation: dependencies.preparation },
    )
    /*
     * The first-run branch sync and MCP connections are independent network waits: the pull only
     * moves the checkout forward, and MCP servers are spawned in, not read from, that checkout.
     * Running them one after another made a first send wait for both, silently.
     */
    const [, visualizationDirectory, mcpTurn] = yield* Effect.all(
      [
        refreshFirstRunBranch(input, executionPath, launchReporter.report),
        prepareVisualizationDirectory(dependencies.inlineVisualization, input.session.id),
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
        }),
      ],
      { concurrency: 'unbounded' },
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
              extensionFactories,
              ...browserPreviewResources,
              trustedExtensionFactories,
            }),
      catch: toAgentKernelError,
    }).pipe(Effect.ensuring(mcpTurn.finish))
  })
}
