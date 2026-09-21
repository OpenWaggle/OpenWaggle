import * as Effect from 'effect/Effect'
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
      ...(input.mcpServerAllowlist !== undefined
        ? { serverAllowlist: input.mcpServerAllowlist }
        : {}),
    })
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
