import { homedir } from 'node:os'
import type { McpSettingsView } from '@shared/types/mcp'
import { Effect } from 'effect'
import {
  createRegistryDraft,
  getMcpRegistryServer,
  mcpRegistryPackageType,
  searchMcpRegistry,
} from './adapters/mcp/registry-client'
import { runMcpRuntimeDoctor } from './adapters/mcp/runtime/runtime-doctor'
import {
  addDefinition,
  definitionFor,
  findServer,
  hasFlag,
  option,
  type ParsedArguments,
  parseImportSources,
  projectPath,
  readSecretFromStdin,
  target,
} from './mcp-cli-arguments'
import {
  type McpCliVault as CliVault,
  type McpCliConfigService as ConfigService,
  createMcpCliManagementRuntime,
  type McpCliManagementRuntime,
} from './mcp-cli-management-runtime'
import { secretReferences } from './mcp-cli-secret-references'
export interface McpCliManagementDependencies {
  readonly createRuntime: (args: ParsedArguments) => Promise<McpCliManagementRuntime>
}

const defaultMcpCliManagementDependencies: McpCliManagementDependencies = {
  createRuntime: createMcpCliManagementRuntime,
}

async function runRegistryCommand(
  service: ConfigService,
  context: { projectPath: string },
  args: ParsedArguments,
) {
  const action = args.positionals[0] ?? 'search'
  const name = args.positionals[1]
  if (action === 'search') {
    return searchMcpRegistry({
      query: name ?? '',
      ...(option(args, 'registry') ? { registryUrl: option(args, 'registry') } : {}),
    })
  }
  if (!name) throw new Error(`Registry ${action} requires a server name.`)
  const server = await getMcpRegistryServer({
    name,
    ...(option(args, 'version') ? { version: option(args, 'version') } : {}),
    ...(option(args, 'registry') ? { registryUrl: option(args, 'registry') } : {}),
  })
  if (action === 'get') return server
  if (action !== 'add') throw new Error(`Unknown registry action ${JSON.stringify(action)}.`)
  const packageType = option(args, 'package')
  const selectedPackageType = mcpRegistryPackageType(packageType)
  if (packageType && !selectedPackageType) {
    throw new Error(
      `Unsupported Registry package type ${JSON.stringify(packageType)}. Expected npm, pypi, nuget, oci, or mcpb.`,
    )
  }
  const draft = await createRegistryDraft({
    server,
    homeDir: homedir(),
    ...(selectedPackageType ? { packageType: selectedPackageType } : {}),
  })
  return service.addServer({
    ...context,
    name: option(args, 'name') ?? draft.name.replace(/[^A-Za-z0-9._-]+/g, '-'),
    target: target(args),
    definition: draft.definition,
  })
}

async function runImportCommand(
  service: ConfigService,
  context: { projectPath: string },
  args: ParsedArguments,
) {
  const sources = parseImportSources(option(args, 'from'))
  const preview = await service.previewImports({ ...context, sources })
  if (!hasFlag(args, 'apply')) return preview
  const requestedConflict = option(args, 'conflict')
  const conflictPolicy =
    requestedConflict === 'replace' || requestedConflict === 'rename' ? requestedConflict : 'skip'
  return service.applyImports({
    ...context,
    sources,
    fingerprints: preview.candidates.map((candidate) => candidate.fingerprint),
    target: target(args),
    conflictPolicy,
  })
}

async function runDoctorCommand(service: ConfigService, context: { projectPath: string }) {
  const [view, doctor] = await Promise.all([
    service.getView(context),
    Effect.runPromise(runMcpRuntimeDoctor()),
  ])
  return { ...doctor, notices: view.notices, integration: view.integration }
}

async function runCredentialCommand(input: {
  readonly command: string
  readonly args: ParsedArguments
  readonly view: McpSettingsView
  readonly server: McpSettingsView['servers'][number]
  readonly vault: CliVault
  readonly authorizeServer: McpCliManagementRuntime['authorizeServer']
  readonly logoutServer: McpCliManagementRuntime['logoutServer']
}) {
  const { vault } = input
  const definition = definitionFor(input.view, input.server)
  if (input.command === 'auth') {
    if (definition.auth?.type === 'oauth' && !hasFlag(input.args, 'secret-stdin')) {
      return input.authorizeServer({
        projectPath: input.view.projectPath,
        instanceId: input.server.instanceId,
      })
    }
    if (!hasFlag(input.args, 'secret-stdin')) {
      throw new Error(
        'This server has no OAuth flow. Use --secret-stdin and pipe a configured credential value on stdin.',
      )
    }
    const references = secretReferences(definition)
    const selected =
      option(input.args, 'secret') ?? (references.length === 1 ? references[0] : undefined)
    if (!selected)
      throw new Error(
        `Choose one credential reference with --secret. Available: ${references.join(', ') || 'none'}.`,
      )
    return vault.set(selected, await readSecretFromStdin())
  }
  if (input.command !== 'logout')
    throw new Error(`Unknown MCP command ${JSON.stringify(input.command)}.`)
  return input.logoutServer({
    projectPath: input.view.projectPath,
    instanceId: input.server.instanceId,
  })
}

async function runNamedServerCommand(
  command: string,
  args: ParsedArguments,
  service: ConfigService,
  context: { projectPath: string },
  vault: CliVault,
  runtime: Pick<McpCliManagementRuntime, 'authorizeServer' | 'logoutServer'>,
) {
  const view = await service.getView(context)
  const server = findServer(view, args.positionals[0])
  if (command === 'get') return server
  if (command === 'enable' || command === 'disable') {
    return service.setServerEnabled({
      ...context,
      instanceId: server.instanceId,
      enabled: command === 'enable',
    })
  }
  if (command === 'trust') {
    return service.setServerTrust({
      ...context,
      instanceId: server.instanceId,
      trusted: true,
      permissions: server.requestedPermissions,
      ...(hasFlag(args, 'allow-unsandboxed') ? { allowUnsandboxed: true } : {}),
    })
  }
  if (command === 'remove')
    return service.removeServer({ ...context, instanceId: server.instanceId })
  return runCredentialCommand({ command, args, view, server, vault, ...runtime })
}

export async function runMcpManagementCommand(
  command: string,
  args: ParsedArguments,
  dependencyOverrides: Partial<McpCliManagementDependencies> = {},
) {
  const dependencies = { ...defaultMcpCliManagementDependencies, ...dependencyOverrides }
  const context = { projectPath: projectPath(args) }
  const runtime = await dependencies.createRuntime(args)
  try {
    const { service, vault } = runtime
    const handlers: Readonly<Record<string, () => Promise<unknown>>> = {
      list: () => service.getView(context),
      add: () => {
        const name = args.positionals[0]
        if (!name) throw new Error('Usage: openwaggle mcp add <name> ...')
        return service.addServer({
          ...context,
          name,
          target: target(args),
          definition: addDefinition(args),
          replace: hasFlag(args, 'replace'),
        })
      },
      import: () => runImportCommand(service, context, args),
      doctor: () => runDoctorCommand(service, context),
      registry: () => runRegistryCommand(service, context, args),
    }
    const handler = handlers[command]
    return handler
      ? await handler()
      : await runNamedServerCommand(command, args, service, context, vault, runtime)
  } finally {
    await runtime.dispose()
  }
}
