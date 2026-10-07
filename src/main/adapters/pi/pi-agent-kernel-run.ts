import * as Effect from 'effect/Effect'
import { withRetainedScratchDirectory } from '../../application/session-scratch-retention'
import type {
  AgentKernelRunInput,
  AgentKernelWaggleRunOptions,
} from '../../ports/agent-kernel-service'
import type { BrowserPreviewAutomationServiceShape } from '../../ports/browser-preview-automation-service'
import type { InlineVisualizationServiceShape } from '../../ports/inline-visualization-service'
import type { TerminalServiceShape } from '../../ports/terminal-service'
import type { WorkspacePreparationServiceShape } from '../../ports/workspace-preparation-service'
import { runPiSession } from './agent-kernel/classic-run'
import type { PiRuntimeExtensionIsolationInput } from './agent-kernel/runtime-extension-isolation'
import { refreshFirstRunBranch } from './agent-kernel/session-branch-freshness'
import { runPiWaggle } from './agent-kernel/waggle-run'
import { createBrowserPreviewAutomationExtension } from './browser-preview-automation-extension'
import { BROWSER_PREVIEW_AUTOMATION_SYSTEM_PROMPT } from './browser-preview-automation-system-prompt'
import {
  createWorktreeLaunchReporter,
  prepareScratchDirectory,
  prepareVisualizationDirectory,
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

export function runPiAgentKernel(
  input: AgentKernelRunInput,
  dependencies: {
    readonly preparation: WorkspacePreparationServiceShape
    readonly projectActions: ProjectActionToolServices
    readonly runtimeExtensionIsolation: PiRuntimeExtensionIsolationInput
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
    const [, visualizationDirectory, scratchDirectory] = yield* Effect.all(
      [
        refreshFirstRunBranch(input, executionPath, launchReporter.report),
        prepareVisualizationDirectory(dependencies.inlineVisualization, input.session.id),
        prepareScratchDirectory(input.session.id),
      ],
      { concurrency: 'unbounded' },
    ).pipe(Effect.onError(() => Effect.sync(() => launchReporter.close())))
    const sessionsExtensionFactory = createRunSessionsExtension(input, executionPath, projectPath)
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
              ...browserPreviewResources,
              trustedExtensionFactories,
            }),
      catch: toAgentKernelError,
    })
  })
}
