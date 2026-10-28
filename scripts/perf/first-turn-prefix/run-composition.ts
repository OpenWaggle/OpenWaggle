import { SessionId } from '@shared/types/brand'
import { classicRunInlineExtensions } from '../../../src/main/adapters/pi/agent-kernel/classic-run'
import { runSystemPromptAppendices } from '../../../src/main/adapters/pi/agent-kernel/run-lifecycle'
import { createOpenWaggleMcpExtensions } from '../../../src/main/adapters/pi/mcp/openwaggle-mcp-extensions'
import {
  createBrowserPreviewRuntimeResources,
  createRunSessionsExtension,
  createRunTrustedExtensionFactories,
} from '../../../src/main/adapters/pi/pi-agent-kernel-run'
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
 * The extension set and prompt appendices of one classic Run, built by the same functions the
 * Host's Run path calls: `createRunSessionsExtension`, `createRunTrustedExtensionFactories` and
 * `createBrowserPreviewRuntimeResources` (`pi-agent-kernel-run.ts`), `classicRunInlineExtensions`
 * (`agent-kernel/classic-run.ts`) and `runSystemPromptAppendices` (`agent-kernel/run-lifecycle.ts`).
 * An extension, tool or appendix added to them is therefore measured against the budget. Only the
 * services behind them are stand-ins (unavailable-services.ts), and MCP is prepared as
 * `prepareMcpExtensions` prepares it. Returns what those functions hand to the Run's Pi runtime.
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
  const { extensionFactories } = classicRunInlineExtensions({
    runId: input.runId,
    sessionsExtensionFactory: createRunSessionsExtension(
      {
        runId: input.runId,
        session: { id: sessionId },
        sessionCapabilities: execution.sessionCapabilities,
      },
      input.projectPath,
      input.projectPath,
      input.scratchDirectory,
    ),
    extensionFactories: await mcpExtensions(input),
    sessionIdentityContext: execution.identityContext,
    runIdentityContext: execution.runIdentityContext,
  })
  const trustedExtensionFactories = createRunTrustedExtensionFactories({
    sessionId,
    runId: input.runId,
    projectPath: input.projectPath,
    browserPreview,
    projectActions: UNAVAILABLE_PROJECT_ACTION_SERVICES,
    docs: installedDocsServices(input.docsBundlePath),
    docsBundlePath: input.docsBundlePath,
  })
  return {
    extensionFactories,
    trustedExtensionFactories,
    // Pi puts them, after the visualization one, in the `openwaggle_session_directories` section
    // that follows the working directory. The Host prepares the evidence directory before the Run;
    // here it is named without being created.
    systemPromptAppendices:
      runSystemPromptAppendices(
        { scratchDirectory: input.scratchDirectory, systemPromptAppendices: browserPreview.systemPromptAppendices },
        (scratchDirectory) => scratchDirectorySystemPrompt(scratchDirectory, sessionEvidenceDirectoryFor(scratchDirectory)),
      ).systemPromptAppendices ?? [],
    visualizationDirectory: input.visualizationDirectory,
    runIdentityContext: execution.runIdentityContext,
  }
}
