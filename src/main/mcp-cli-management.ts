import { homedir } from 'node:os'
import type { McpSettingsView } from '@shared/types/mcp'
import { Effect } from 'effect'
import { authorizeMcpServer, logoutMcpOAuth } from './adapters/mcp/oauth-provider'
import {
  createRegistryDraft,
  getMcpRegistryServer,
  mcpRegistryPackageType,
  searchMcpRegistry,
} from './adapters/mcp/registry-client'
import { runMcpRuntimeDoctor } from './adapters/mcp/runtime/runtime-doctor'
import { openExternal } from './desktop-ui'
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
  reconcileOwningMcpHost,
} from './mcp-cli-management-runtime'
import {
  partitionServerLogoutSecretReferences,
  secretReferences,
} from './mcp-cli-secret-references'
export interface McpCliManagementDependencies {
  readonly reconcileOwnerRuntime: (args: ParsedArguments, projectPath: string) => Promise<void>
}

const defaultMcpCliManagementDependencies: McpCliManagementDependencies = {
  reconcileOwnerRuntime: reconcileOwningMcpHost,
}

const MUTATING_NAMED_SERVER_COMMANDS = new Set([
  'auth',
  'disable',
  'enable',
  'logout',
  'remove',
  'trust',
])

function mcpManagementCommandMutates(command: string, args: ParsedArguments) {
  if (command === 'add') return true
  if (command === 'import') return hasFlag(args, 'apply')
  if (command === 'registry') return (args.positionals[0] ?? 'search') === 'add'
  return MUTATING_NAMED_SERVER_COMMANDS.has(command)
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

async function removeSecretReferences(
  vault: CliVault,
  references: readonly string[],
  index = 0,
): Promise<void> {
  const name = references[index]
  if (!name) return
  await vault.remove(name)
  return removeSecretReferences(vault, references, index + 1)
}

async function runCredentialCommand(input: {
  readonly command: string
  readonly args: ParsedArguments
  readonly view: McpSettingsView
  readonly server: McpSettingsView['servers'][number]
  readonly vault: CliVault
  readonly reconcileOwnerRuntime: () => Promise<void>
}) {
  const { vault } = input
  const definition = definitionFor(input.view, input.server)
  const references = secretReferences(definition)
  if (input.command === 'auth') {
    if (definition.auth?.type === 'oauth' && !hasFlag(input.args, 'secret-stdin')) {
      const result = await authorizeMcpServer({
        instanceId: input.server.instanceId,
        definition,
        vault,
        openExternal,
      })
      // A prior attempt may have persisted valid tokens before owner notification failed.
      // Reconcile even when this attempt discovers authorization without another vault write.
      await input.reconcileOwnerRuntime()
      return result
    }
    if (!hasFlag(input.args, 'secret-stdin')) {
      throw new Error(
        'This server has no OAuth flow. Use --secret-stdin and pipe a configured credential value on stdin.',
      )
    }
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
  if (definition.auth?.type === 'oauth') {
    await logoutMcpOAuth({ instanceId: input.server.instanceId, vault })
  }
  const partition = partitionServerLogoutSecretReferences({
    references,
    sources: input.view.sources,
    target: input.server,
  })
  await removeSecretReferences(vault, partition.removable)
  return {
    removedSecrets: partition.removable,
    retainedSharedSecrets: partition.retained,
    retainedUnverifiedSecrets: partition.retainedUnverified,
    unreadableSources: partition.unreadableSources,
    oauthRemoved: definition.auth?.type === 'oauth',
  }
}

async function runNamedServerCommand(
  command: string,
  args: ParsedArguments,
  service: ConfigService,
  context: { projectPath: string },
  vault: CliVault,
  reconcileOwnerRuntime: () => Promise<void>,
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
  return runCredentialCommand({ command, args, view, server, vault, reconcileOwnerRuntime })
}

export async function runMcpManagementCommand(
  command: string,
  args: ParsedArguments,
  dependencyOverrides: Partial<McpCliManagementDependencies> = {},
) {
  const dependencies = { ...defaultMcpCliManagementDependencies, ...dependencyOverrides }
  const context = { projectPath: projectPath(args) }
  const reconcileOwnerRuntime = () => dependencies.reconcileOwnerRuntime(args, context.projectPath)
  if (mcpManagementCommandMutates(command, args)) await reconcileOwnerRuntime()
  const runtime = createMcpCliManagementRuntime(reconcileOwnerRuntime)
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
      : await runNamedServerCommand(command, args, service, context, vault, reconcileOwnerRuntime)
  } finally {
    await runtime.dispose()
  }
}
