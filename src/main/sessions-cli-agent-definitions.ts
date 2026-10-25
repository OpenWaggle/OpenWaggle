import os from 'node:os'
import {
  type AgentDefinitionProjectResolver,
  resolveAgentDefinitionProject,
} from './agent-definition-project'
import { listAgentDefinitions, searchAgentDefinitions } from './agents/agent-definition-catalog'
import { agentDefinitionsProjectPath } from './agents-cli-options'
import { compactAgentCatalog, writeAgentsCliCatalog } from './agents-cli-output'
import { asUsageErrorsSync } from './cli-error'
import { writeCliStdout } from './cli-stdout'
import { env } from './env'
import {
  createLocalSessionCliClientInput,
  prepareLocalSessionCliClientInput,
} from './local-session-cli-client'
import { hasFlag, option, type ParsedArguments } from './mcp-cli-arguments'
import { SESSION_CLI_EXIT as EXIT } from './session-cli-exit-status'
import { required } from './sessions-cli-arguments'
import { sessionsCliResponseText } from './sessions-cli-output'

export interface AgentDefinitionDiscoveryIo {
  readonly cwd?: string
  readonly home?: string
  readonly stdout?: (value: string) => void | Promise<void>
  readonly resolveProject?: AgentDefinitionProjectResolver
  /** Checks the caller as every Hive command does; replaced in tests. */
  readonly verifyCaller?: (arguments_: ParsedArguments) => Promise<unknown>
}

/**
 * Discovery reads files in this process, but it is a Hive command: an agent Run without a named
 * profile is refused as everywhere else, and a named profile must authenticate (#351).
 */
function verifyDiscoveryCaller(arguments_: ParsedArguments) {
  return option(arguments_, 'profile') !== undefined || env.OPENWAGGLE_PROFILE !== undefined
    ? createLocalSessionCliClientInput(arguments_)
    : prepareLocalSessionCliClientInput(arguments_)
}

/**
 * `hive agent-definitions-list` and `hive agent-definitions-search`, the tool's
 * `agent_definitions_list` and `agent_definitions_search`. They read definition files in this
 * process; `--json` answers with the tool's `{ definitions }` shape in the Hive CLI envelope.
 * Like the tool, they leave out definitions turned off for the project, which spawn and launch
 * refuse. The file-authoring commands under `openwaggle agents` still reach every definition.
 */
export async function runAgentDefinitionDiscoveryCommand(
  command: string,
  arguments_: ParsedArguments,
  io: AgentDefinitionDiscoveryIo = {},
) {
  await (io.verifyCaller ?? verifyDiscoveryCaller)(arguments_)
  // A managed worktree, or a folder inside one, reads its Session's project; any other folder is
  // read as its own project, as launch takes it.
  const { projectPath, enabledByName } = await (io.resolveProject ?? resolveAgentDefinitionProject)(
    agentDefinitionsProjectPath(arguments_, io.cwd ?? process.cwd()),
  )
  const userHome = io.home ?? os.homedir()
  const stdout = io.stdout ?? writeCliStdout
  const items =
    command === 'agent-definitions-search'
      ? await searchAgentDefinitions({
          projectPath,
          userHome,
          query: asUsageErrorsSync(() =>
            required(arguments_.positionals.join(' '), 'Search query'),
          ),
        })
      : await listAgentDefinitions({ projectPath, userHome })
  const definitions = compactAgentCatalog(
    items.filter((item) => enabledByName[item.name] !== false),
  )
  if (hasFlag(arguments_, 'json')) {
    await stdout(sessionsCliResponseText(command, { definitions }, true))
  } else {
    await writeAgentsCliCatalog(definitions, false, stdout)
  }
  return EXIT.SUCCESS
}
