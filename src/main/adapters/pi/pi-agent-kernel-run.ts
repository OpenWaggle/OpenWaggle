import * as Effect from 'effect/Effect'
import { withRetainedScratchDirectory } from '../../application/session-scratch-retention'
import { createLogger } from '../../logger'
import type {
  AgentKernelRunInput,
  AgentKernelWaggleRunOptions,
} from '../../ports/agent-kernel-service'
import type { BrowserPreviewAutomationServiceShape } from '../../ports/browser-preview-automation-service'
import type { InlineVisualizationServiceShape } from '../../ports/inline-visualization-service'
import type { TerminalServiceShape } from '../../ports/terminal-service'
import type { WorkspacePreparationServiceShape } from '../../ports/workspace-preparation-service'
import { isSessionMcpEnabled } from '../../store/session-mcp-switch'
import type { McpConnectionPool } from '../mcp/pool/mcp-connection-pool-api'
import { runPiSession } from './agent-kernel/classic-run'
import type { PiRuntimeExtensionIsolationInput } from './agent-kernel/runtime-extension-isolation'
import { refreshFirstRunBranch } from './agent-kernel/session-branch-freshness'
import { runPiWaggle } from './agent-kernel/waggle-run'
import { createBrowserPreviewAutomationExtension } from './browser-preview-automation-extension'
import { BROWSER_PREVIEW_AUTOMATION_SYSTEM_PROMPT } from './browser-preview-automation-system-prompt'
import { resolveLegacyMcpServerAllowlist } from './mcp/legacy-mcp-server-allowlist'
import { getOpenWaggleMcpConfigurationService } from './mcp/openwaggle-mcp-configuration'
import { createOpenWaggleMcpExtensions } from './mcp/openwaggle-mcp-extensions'
import { migrateOpenWaggleMcpFilesOnce } from './mcp/openwaggle-mcp-migration'
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
import { createSourceControlToolExtension } from './source-control-tool-extension'

const logger = createLogger('pi-agent-kernel-run')

/**
 * Pi's MCP extension for this Run. A configuration that cannot be prepared is logged and the Run
 * goes ahead without MCP, rather than failing the user's message.
 */
function prepareMcpExtensions(
  input: AgentKernelRunInput,
  projectPath: string,
  pool: McpConnectionPool,
) {
  return Effect.tryPromise(async () => {
    // The migration carries an old MCP-off Session switch over, so it runs before the switch is read.
    await migrateOpenWaggleMcpFilesOnce(projectPath)
    return createOpenWaggleMcpExtensions({
      pool,
      sessionId: input.session.id,
      projectPath,
      sessionMcpEnabled: await isSessionMcpEnabled(input.session.id),
      onConfigChanged: (filePath) => getOpenWaggleMcpConfigurationService().changed(filePath),
      ...(input.mcpServerAllowlist ? { serverAllowlist: input.mcpServerAllowlist } : {}),
    })
  }).pipe(
    Effect.catchAll((error) =>
      Effect.sync(() => {
        logger.error('MCP could not be prepared for the Run', {
          sessionId: input.session.id,
          error: error.message,
        })
        return []
      }),
    ),
  )
}

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
    /** The Host's MCP connection pool, which keeps the Session's servers across Runs. */
    readonly mcpPool: McpConnectionPool
  },
) {
  // A Session's MCP connections stay warm while it has a Run and close 5 minutes after its last.
  return Effect.acquireUseRelease(
    Effect.sync(() => dependencies.mcpPool.beginRun(input.session.id)),
    () => withRetainedScratchDirectory(input.session.id, runPiAgentKernelTurn(input, dependencies)),
    (endRun) => Effect.sync(endRun),
  )
}

/**
 * The Run's input with old MCP instance IDs in its server allowlist replaced by server names. The
 * migration records those names, so it runs first; the allowlist is kept as is when it fails.
 */
function withLegacyMcpServerNames(input: AgentKernelRunInput, projectPath: string) {
  if (!input.mcpServerAllowlist?.length) return Effect.succeed(input)
  return Effect.tryPromise(async () => {
    await migrateOpenWaggleMcpFilesOnce(projectPath)
    const mcpServerAllowlist = await resolveLegacyMcpServerAllowlist(input.mcpServerAllowlist)
    return { ...input, ...(mcpServerAllowlist ? { mcpServerAllowlist } : {}) }
  }).pipe(Effect.orElseSucceed(() => input))
}

function runPiAgentKernelTurn(
  originalInput: AgentKernelRunInput,
  dependencies: Parameters<typeof runPiAgentKernel>[1],
) {
  return Effect.gen(function* () {
    const launchReporter = createWorktreeLaunchReporter(originalInput)
    const { projectPath, executionPath, preparedEnvironment } = yield* prepareActionWorkspace(
      launchReporter.runInput,
      { workspaces: dependencies.projectActions.workspaces, preparation: dependencies.preparation },
    )
    const input = yield* withLegacyMcpServerNames(originalInput, projectPath)
    const [, visualizationDirectory, scratchDirectory, extensionFactories] = yield* Effect.all(
      [
        refreshFirstRunBranch(input, executionPath, launchReporter.report),
        prepareVisualizationDirectory(dependencies.inlineVisualization, input.session.id),
        prepareScratchDirectory(input.session.id),
        prepareMcpExtensions(input, projectPath, dependencies.mcpPool),
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
      createSourceControlToolExtension({
        sessionId: input.session.id,
        workspaces: dependencies.projectActions.workspaces,
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
              extensionFactories,
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
              extensionFactories,
              ...(visualizationDirectory ? { visualizationDirectory } : {}),
              ...(scratchDirectory ? { scratchDirectory } : {}),
              ...browserPreviewResources,
              trustedExtensionFactories,
            }),
      catch: toAgentKernelError,
    })
  })
}
