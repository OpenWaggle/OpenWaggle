import { SessionId } from '@shared/types/brand'
import { createAgentRunContextExtension } from '../../../src/main/adapters/pi/agent-run-context-extension'
import { createDelegationSpecificationUpdateExtension } from '../../../src/main/adapters/pi/delegation-specification-update-extension'
import { createOpenWaggleMcpExtensions } from '../../../src/main/adapters/pi/mcp/openwaggle-mcp-extensions'
import { createOrchestrationUpdateExtension } from '../../../src/main/adapters/pi/orchestration-update-extension'
import { createPeerAgentReportExtension } from '../../../src/main/adapters/pi/peer-agent-report-extension'
import { createOpenWaggleDocsToolExtension } from '../../../src/main/adapters/pi/openwaggle-docs-tool-extension'
import { createBrowserPreviewRuntimeResources } from '../../../src/main/adapters/pi/pi-agent-kernel-run'
import { createProjectActionsToolExtension } from '../../../src/main/adapters/pi/project-actions-tool-extension'
import { createRunAttributionExtension } from '../../../src/main/adapters/pi/run-attribution-extension'
import { createSessionsToolExtension } from '../../../src/main/adapters/pi/sessions-tool-extension'
import { createSourceControlToolExtension } from '../../../src/main/adapters/pi/source-control-tool-extension'
import type { McpConnectionPool } from '../../../src/main/adapters/mcp/pool/mcp-connection-pool-api'
import { scratchDirectorySystemPrompt } from '../../../src/main/adapters/pi/pi-provider-resources'
import { resolveSessionRunExecution } from '../../../src/main/adapters/session-run-execution-profile'
import { sessionEvidenceDirectoryFor } from '../../../src/main/utils/session-evidence-directory'
import { identityRowForRole, type PrefixSessionRole } from './session-identity-rows'
import {
  installedDocsServices,
  UNAVAILABLE_BROWSER_PREVIEW_SERVICE,
  UNAVAILABLE_PROJECT_ACTION_SERVICES,
} from './unavailable-services'

export interface FirstTurnRunInput {
  readonly projectPath: string
  readonly role: PrefixSessionRole
  readonly sessionId: string
  readonly runId: string
  readonly modelId: string
  readonly browserPreview: boolean
  readonly scratchDirectory: string
  readonly visualizationDirectory: string
  readonly docsBundlePath: string
  readonly mcpPool: McpConnectionPool
}

function noDelivery() {}

/** The Run's MCP extensions, as `prepareMcpExtensions` in `pi-agent-kernel-run.ts` builds them. */
function mcpExtensions(input: FirstTurnRunInput) {
  return createOpenWaggleMcpExtensions({
    pool: input.mcpPool,
    sessionId: input.sessionId,
    projectPath: input.projectPath,
    sessionMcpEnabled: true,
    onConfigChanged: noDelivery,
  })
}

/**
 * Mirrors the extension set of one classic Run, in the Host's order: `runPiAgentKernelTurn` in
 * `pi-agent-kernel-run.ts` (sessions, MCP, preview, project actions, source control, docs) and
 * `runPiSession` in `agent-kernel/classic-run.ts` (run attribution, deliveries, Run identity).
 * Keep it in step with those two functions; the packaged measurement catches any drift. Returns
 * what those functions hand to the Run's Pi runtime.
 */
export async function composeFirstTurnRun(input: FirstTurnRunInput) {
  const execution = resolveSessionRunExecution(
    identityRowForRole(input.role, input),
    input.runId,
  )
  const sessionId = SessionId(input.sessionId)
  const browserPreview = createBrowserPreviewRuntimeResources({
    enabled: input.browserPreview,
    sessionId,
    workingPath: input.projectPath,
    service: UNAVAILABLE_BROWSER_PREVIEW_SERVICE,
  })
  const deliveries = { runId: input.runId, onDelivered: noDelivery }
  const extensionFactories = [
    createRunAttributionExtension(input.runId),
    createPeerAgentReportExtension({ ...deliveries, pendingReports: [] }).factory,
    createOrchestrationUpdateExtension({ ...deliveries, pendingUpdates: [] }).factory,
    createDelegationSpecificationUpdateExtension({ ...deliveries, pendingUpdates: [] }).factory,
    createSessionsToolExtension({
      sessionId: input.sessionId,
      runId: input.runId,
      workingDirectory: input.projectPath,
      projectPath: input.projectPath,
      sessionCapabilities: execution.sessionCapabilities,
    }),
    ...(await mcpExtensions(input)),
    createAgentRunContextExtension({
      sessionIdentityContext: execution.identityContext,
      runIdentityContext: execution.runIdentityContext,
    }),
  ]
  const trustedExtensionFactories = [
    ...browserPreview.trustedExtensionFactories,
    createProjectActionsToolExtension({
      ...UNAVAILABLE_PROJECT_ACTION_SERVICES,
      sessionId: input.sessionId,
      runId: input.runId,
    }),
    createSourceControlToolExtension({
      sessionId: input.sessionId,
      workspaces: UNAVAILABLE_PROJECT_ACTION_SERVICES.workspaces,
    }),
    createOpenWaggleDocsToolExtension({
      services: installedDocsServices(input.docsBundlePath),
      projectPath: input.projectPath,
      bundlePath: input.docsBundlePath,
    }),
  ]
  return {
    extensionFactories,
    trustedExtensionFactories,
    systemPromptAppendices: [
      scratchDirectorySystemPrompt(
        input.scratchDirectory,
        sessionEvidenceDirectoryFor(input.scratchDirectory),
      ),
      ...browserPreview.systemPromptAppendices,
    ],
    visualizationDirectory: input.visualizationDirectory,
    runIdentityContext: execution.runIdentityContext,
  }
}
