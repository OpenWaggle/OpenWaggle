import os from 'node:os'
import path from 'node:path'
import type { AgentDefinitionManagementOutcome } from '@shared/types/agent-definition-management'
import { loadAgentDefinitionSemanticCatalog } from './agent-definition-semantic-catalog-loader'
import {
  listAgentDefinitions,
  resolveAgentDefinition,
  searchAgentDefinitions,
} from './agents/agent-definition-catalog'
import {
  type AgentDefinitionSemanticCatalogLoader,
  executeAgentDefinitionManagement,
} from './agents/agent-definition-management'
import { parseAgentDefinition } from './agents/agent-definition-parser'
import { validateAgentDefinitionSemantics } from './agents/agent-definition-semantic-validation'
import {
  readAgentsCliDocumentSource,
  readBoundedAgentsCliStdin,
  writeAgentsCliDocument,
} from './agents-cli-document-source'
import { validateAgentsCliOptions } from './agents-cli-option-contract'
import {
  agentDefinitionsProjectPath,
  managementContext,
  parseAgentDefinitionImportSource,
  parseAgentDefinitionScope,
  required,
} from './agents-cli-options'
import {
  compactAgentCatalog,
  writeAgentsCliCatalog,
  writeAgentsCliError,
  writeAgentsCliResult,
} from './agents-cli-output'
import { AGENTS_CLI_USAGE } from './agents-cli-usage'
import { writeCliStdout } from './cli-stdout'
import { isCommandCliUsageError, validateImplicitCliHelp } from './command-cli-option-contract'
import { hasFlag, option, parseMcpCliArguments } from './mcp-cli-arguments'

const EXIT = { SUCCESS: 0, FAILURE: 1, USAGE: 2 } as const

export interface AgentsCliIo {
  readonly cwd?: string
  readonly home?: string
  readonly stdout?: (value: string) => void | Promise<void>
  readonly stderr?: (value: string) => void
  readonly readStdin?: () => Promise<string>
  readonly loadSemanticCatalog?: AgentDefinitionSemanticCatalogLoader
}

async function importCommand(input: {
  readonly arguments_: ReturnType<typeof parseMcpCliArguments>
  readonly cwd: string
  readonly home: string
  readonly projectPath: string
  readonly loadSemanticCatalog: AgentDefinitionSemanticCatalogLoader
}) {
  const sourcePath = path.resolve(
    input.cwd,
    required(input.arguments_.positionals[0], 'Import file'),
  )
  const base = {
    projectPath: input.projectPath,
    sourcePath,
    sourceTool: parseAgentDefinitionImportSource(option(input.arguments_, 'from')),
    ...(option(input.arguments_, 'source-name')
      ? { sourceName: option(input.arguments_, 'source-name') }
      : {}),
    targetScope: parseAgentDefinitionScope(option(input.arguments_, 'scope')),
  } as const
  const planned = await executeAgentDefinitionManagement(
    { operation: 'import-plan', ...base },
    managementContext(input),
  )
  if (planned.operation !== 'import-plan') throw new Error('Expected an Agent import plan.')
  if (hasFlag(input.arguments_, 'dry-run')) return planned
  if (planned.plan.status === 'blocked') {
    throw new Error(planned.plan.diagnostics.join(' ') || 'Agent import plan is blocked.')
  }
  if (planned.plan.status === 'conflict' && !hasFlag(input.arguments_, 'replace')) {
    throw new Error('Agent definition exists; review the plan and use --replace explicitly.')
  }
  return executeAgentDefinitionManagement(
    {
      operation: 'import-apply',
      ...base,
      expectedSourceDigest: planned.plan.sourceDigest,
      ...(hasFlag(input.arguments_, 'replace') ? { replaceExisting: true } : {}),
      ...(option(input.arguments_, 'expected-digest')
        ? { expectedContentDigest: option(input.arguments_, 'expected-digest') }
        : {}),
    },
    managementContext(input),
  )
}

async function refreshCommand(input: {
  readonly arguments_: ReturnType<typeof parseMcpCliArguments>
  readonly home: string
  readonly projectPath: string
  readonly loadSemanticCatalog: AgentDefinitionSemanticCatalogLoader
}) {
  const name = required(input.arguments_.positionals[0], 'Agent definition name')
  const planned = await executeAgentDefinitionManagement(
    { operation: 'refresh-plan', projectPath: input.projectPath, name },
    managementContext(input),
  )
  if (planned.operation !== 'refresh-plan') throw new Error('Expected an Agent refresh plan.')
  if (hasFlag(input.arguments_, 'dry-run')) return planned
  if (planned.plan.status === 'blocked') {
    throw new Error(planned.plan.diagnostics.join(' ') || 'Agent refresh plan is blocked.')
  }
  return executeAgentDefinitionManagement(
    {
      operation: 'refresh-apply',
      projectPath: input.projectPath,
      name,
      expectedSourceDigest: planned.plan.sourceDigest,
      ...(hasFlag(input.arguments_, 'replace') ? { replaceModified: true } : {}),
    },
    managementContext(input),
  )
}

async function mutationCommand(input: {
  readonly command: string
  readonly arguments_: ReturnType<typeof parseMcpCliArguments>
  readonly cwd: string
  readonly home: string
  readonly projectPath: string
  readonly readStdin: () => Promise<string>
  readonly loadSemanticCatalog: AgentDefinitionSemanticCatalogLoader
}): Promise<AgentDefinitionManagementOutcome | undefined> {
  if (input.command === 'create' || input.command === 'update') {
    return writeAgentsCliDocument({ ...input, command: input.command })
  }
  if (input.command === 'duplicate') {
    return executeAgentDefinitionManagement(
      {
        operation: 'duplicate',
        projectPath: input.projectPath,
        sourceName: required(input.arguments_.positionals[0], 'Source Agent name'),
        targetName: required(input.arguments_.positionals[1], 'Target Agent name'),
        targetScope: parseAgentDefinitionScope(option(input.arguments_, 'scope')),
      },
      managementContext(input),
    )
  }
  if (input.command === 'delete') {
    return executeAgentDefinitionManagement(
      {
        operation: 'delete',
        projectPath: input.projectPath,
        name: required(input.arguments_.positionals[0], 'Agent definition name'),
        scope: parseAgentDefinitionScope(option(input.arguments_, 'scope')),
        ...(option(input.arguments_, 'expected-digest')
          ? { expectedContentDigest: option(input.arguments_, 'expected-digest') }
          : {}),
      },
      managementContext(input),
    )
  }
  if (input.command === 'import') return importCommand(input)
  if (input.command === 'refresh') return refreshCommand(input)
  return undefined
}

async function executeAgentDefinitionCommand(input: {
  readonly command: string
  readonly arguments_: ReturnType<typeof parseMcpCliArguments>
  readonly cwd: string
  readonly home: string
  readonly stdout: (value: string) => void | Promise<void>
  readonly readStdin: () => Promise<string>
  readonly loadSemanticCatalog: AgentDefinitionSemanticCatalogLoader
}) {
  const { command, arguments_, cwd, home, stdout } = input
  const json = hasFlag(arguments_, 'json')
  const project = agentDefinitionsProjectPath(arguments_, cwd)
  const mutation = await mutationCommand({
    command,
    arguments_,
    cwd,
    home,
    projectPath: project,
    readStdin: input.readStdin,
    loadSemanticCatalog: input.loadSemanticCatalog,
  })
  if (mutation) {
    await writeAgentsCliResult(mutation, json, stdout)
    return EXIT.SUCCESS
  }
  if (command === 'list' || command === 'search') {
    const items =
      command === 'list'
        ? await listAgentDefinitions({ projectPath: project, userHome: home })
        : await searchAgentDefinitions({
            projectPath: project,
            userHome: home,
            query: required(arguments_.positionals.join(' '), 'Search query'),
          })
    await writeAgentsCliCatalog(compactAgentCatalog(items), json, stdout)
    return EXIT.SUCCESS
  }
  if (command === 'validate') {
    const source = await readAgentsCliDocumentSource({
      argument: arguments_.positionals[0],
      label: 'File',
      cwd,
      readStdin: input.readStdin,
    })
    const definition = parseAgentDefinition(source.content)
    const validation = validateAgentDefinitionSemantics(
      definition,
      await input.loadSemanticCatalog({ projectPath: project, userHome: home }),
    )
    await writeAgentsCliResult(
      {
        valid: validation.valid,
        name: definition.name,
        sourcePath: source.sourcePath,
        diagnostics: validation.diagnostics,
      },
      json,
      stdout,
    )
    return validation.valid ? EXIT.SUCCESS : EXIT.FAILURE
  }
  if (command === 'explain') {
    const definition = await resolveAgentDefinition({
      projectPath: project,
      userHome: home,
      name: required(arguments_.positionals[0], 'Agent definition name'),
    })
    const validation = validateAgentDefinitionSemantics(
      definition,
      await input.loadSemanticCatalog({ projectPath: project, userHome: home }),
    )
    await writeAgentsCliResult({ ...definition, semanticValidation: validation }, json, stdout)
    return validation.valid ? EXIT.SUCCESS : EXIT.FAILURE
  }
  throw new Error(`Unsupported Agent definitions command: ${command}.`)
}

export async function runAgentsCli(args: readonly string[], io: AgentsCliIo = {}) {
  const cwd = io.cwd ?? process.cwd()
  const home = io.home ?? os.homedir()
  const stdout = io.stdout ?? writeCliStdout
  const stderr = io.stderr ?? ((value: string) => process.stderr.write(value))
  const readStdin = io.readStdin ?? readBoundedAgentsCliStdin
  const loadSemanticCatalog = io.loadSemanticCatalog ?? loadAgentDefinitionSemanticCatalog
  const parsed = parseMcpCliArguments(args)
  const command = parsed.positionals[0]
  const arguments_ = { ...parsed, positionals: parsed.positionals.slice(1) }
  try {
    if (!command) {
      validateImplicitCliHelp('OpenWaggle Agents', parsed)
      await stdout(AGENTS_CLI_USAGE)
      return EXIT.SUCCESS
    }
    validateAgentsCliOptions(command, arguments_)
    if (command === 'help') {
      await stdout(AGENTS_CLI_USAGE)
      return EXIT.SUCCESS
    }
    return await executeAgentDefinitionCommand({
      command,
      arguments_,
      cwd,
      home,
      stdout,
      readStdin,
      loadSemanticCatalog,
    })
  } catch (error) {
    writeAgentsCliError(error, hasFlag(arguments_, 'json'), stderr)
    return isCommandCliUsageError(error) ||
      (error instanceof Error && error.message.includes('required'))
      ? EXIT.USAGE
      : EXIT.FAILURE
  }
}
