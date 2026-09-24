import {
  type AgentSessionServices,
  createBashToolDefinition,
  createPowerShellToolDefinition,
  defineTool,
  type SessionManager,
  type ToolDefinition,
} from '@earendil-works/pi-coding-agent'
import type { ThinkingLevel } from '@shared/types/settings'
import {
  applyPreparedEnvironment,
  type PreparedEnvironment,
  withoutWorkspaceContext,
} from '../../../domain/prepared-environment'
import type { PiModel } from '../pi-provider-catalog'
import {
  createOpenWaggleAgentSessionFromServices,
  type OpenWaggleAgentSessionOptions,
} from '../pi-session-lifecycle'

export async function createPiSessionForRun(input: {
  readonly preparedEnvironment?: PreparedEnvironment
  readonly projectRoot: string
  readonly workspacePath: string
  readonly services: AgentSessionServices
  readonly model: PiModel
  readonly sessionManager: SessionManager
  readonly thinkingLevel: ThinkingLevel
  readonly openWaggleUi: OpenWaggleAgentSessionOptions['openWaggleUi']
}) {
  const markAgentRun = (context: { command: string; cwd: string; env: NodeJS.ProcessEnv }) => ({
    ...context,
    env: {
      ...applyPreparedEnvironment(
        withoutWorkspaceContext(context.env),
        withoutWorkspaceContext(input.preparedEnvironment ?? {}),
        process.platform === 'win32',
      ),
      // Pi's spawn context starts from the detached Host environment, not Session metadata.
      OPENWAGGLE_PROJECT_ROOT: input.projectRoot,
      OPENWAGGLE_WORKTREE_PATH: input.workspacePath,
      OPENWAGGLE_AGENT_RUN: '1',
    },
  })
  const customTools: ToolDefinition[] = [
    defineTool(createBashToolDefinition(input.services.cwd, { spawnHook: markAgentRun })),
    defineTool(createPowerShellToolDefinition(input.services.cwd, { spawnHook: markAgentRun })),
  ]
  const hasExistingMessages = input.sessionManager.buildSessionContext().messages.length > 0
  const result = await createOpenWaggleAgentSessionFromServices({
    services: input.services,
    model: input.model,
    sessionManager: input.sessionManager,
    openWaggleUi: input.openWaggleUi,
    customTools,
    ...(!hasExistingMessages ? { thinkingLevel: input.thinkingLevel } : {}),
  })
  if (hasExistingMessages) result.session.setThinkingLevel(input.thinkingLevel)
  return result
}
