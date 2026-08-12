import { homedir } from 'node:os'
import type { McpSecretSummary, McpSettingsView } from '@shared/types/mcp'
import { Effect, Layer, ManagedRuntime } from 'effect'
import { shell } from 'electron'
import { EncryptedMcpSecretVaultServiceLive } from './adapters/mcp/encrypted-mcp-secret-vault-service'
import { FilesystemMcpConfigServiceLive } from './adapters/mcp/filesystem-mcp-config-service'
import { McpTurnStateServiceLive } from './adapters/mcp/mcp-turn-state-service'
import { authorizeMcpServer, logoutMcpOAuth } from './adapters/mcp/oauth-provider'
import {
  createRegistryDraft,
  getMcpRegistryServer,
  mcpRegistryPackageType,
  searchMcpRegistry,
} from './adapters/mcp/registry-client'
import { runMcpRuntimeDoctor } from './adapters/mcp/runtime/runtime-doctor'
import type { createFilesystemMcpConfigService } from './adapters/mcp/service-factory'
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
  partitionServerLogoutSecretReferences,
  secretReferences,
} from './mcp-cli-secret-references'
import { McpConfigService } from './ports/mcp-config-service'
import { McpSecretVaultService } from './ports/mcp-secret-vault-service'

type ConfigService = ReturnType<typeof createFilesystemMcpConfigService>

/** Vault surface used by the CLI, mirroring the encrypted-vault adapter shape. */
interface CliVault {
  list(): Promise<readonly McpSecretSummary[]>
  resolve(name: string): Promise<string>
  set(name: string, value: string): Promise<readonly McpSecretSummary[]>
  remove(name: string): Promise<readonly McpSecretSummary[]>
}

/**
 * The CLI management commands run through the SAME MCP config/vault Live layers
 * as the desktop app and hosted servers — composed here into a lightweight
 * runtime (no database) rather than reconstructing parallel service instances.
 */
const McpManagementLayer = Layer.mergeAll(
  FilesystemMcpConfigServiceLive,
  EncryptedMcpSecretVaultServiceLive,
).pipe(Layer.provide(McpTurnStateServiceLive))

function configServiceAdapter(runtime: ManagedRuntime.ManagedRuntime<McpConfigService, never>) {
  return {
    getServerDefinition: (input) =>
      runtime.runPromise(
        McpConfigService.pipe(Effect.flatMap((s) => s.getServerDefinition(input))),
      ),
    getView: (input) =>
      runtime.runPromise(McpConfigService.pipe(Effect.flatMap((s) => s.getView(input)))),
    setScopeState: (input) =>
      runtime.runPromise(McpConfigService.pipe(Effect.flatMap((s) => s.setScopeState(input)))),
    setServerEnabled: (input) =>
      runtime.runPromise(McpConfigService.pipe(Effect.flatMap((s) => s.setServerEnabled(input)))),
    setProjectServerEnabled: (input) =>
      runtime.runPromise(
        McpConfigService.pipe(Effect.flatMap((s) => s.setProjectServerEnabled(input))),
      ),
    setServerTrust: (input) =>
      runtime.runPromise(McpConfigService.pipe(Effect.flatMap((s) => s.setServerTrust(input)))),
    writeSourceConfig: (input) =>
      runtime.runPromise(McpConfigService.pipe(Effect.flatMap((s) => s.writeSourceConfig(input)))),
    removeServer: (input) =>
      runtime.runPromise(McpConfigService.pipe(Effect.flatMap((s) => s.removeServer(input)))),
    addServer: (input) =>
      runtime.runPromise(McpConfigService.pipe(Effect.flatMap((s) => s.addServer(input)))),
    previewImports: (input) =>
      runtime.runPromise(McpConfigService.pipe(Effect.flatMap((s) => s.previewImports(input)))),
    applyImports: (input) =>
      runtime.runPromise(McpConfigService.pipe(Effect.flatMap((s) => s.applyImports(input)))),
    createTurnSnapshot: (input) =>
      runtime.runPromise(McpConfigService.pipe(Effect.flatMap((s) => s.createTurnSnapshot(input)))),
  } satisfies ConfigService
}

function vaultAdapter(
  runtime: ManagedRuntime.ManagedRuntime<McpSecretVaultService, never>,
): CliVault {
  return {
    list: () => runtime.runPromise(McpSecretVaultService.pipe(Effect.flatMap((v) => v.list()))),
    resolve: (name) =>
      runtime.runPromise(McpSecretVaultService.pipe(Effect.flatMap((v) => v.resolve(name)))),
    set: (name, value) =>
      runtime.runPromise(McpSecretVaultService.pipe(Effect.flatMap((v) => v.set({ name, value })))),
    remove: (name) =>
      runtime.runPromise(McpSecretVaultService.pipe(Effect.flatMap((v) => v.remove({ name })))),
  }
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
  const view = await service.getView(context)
  const doctor = await Effect.runPromise(runMcpRuntimeDoctor())
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
}) {
  const { vault } = input
  const definition = definitionFor(input.view, input.server)
  const references = secretReferences(definition)
  if (input.command === 'auth') {
    if (definition.auth?.type === 'oauth' && !hasFlag(input.args, 'secret-stdin')) {
      return authorizeMcpServer({
        instanceId: input.server.instanceId,
        definition,
        vault,
        openExternal: (url) => shell.openExternal(url),
      })
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
  return runCredentialCommand({ command, args, view, server, vault })
}

export async function runMcpManagementCommand(command: string, args: ParsedArguments) {
  const runtime = ManagedRuntime.make(McpManagementLayer)
  try {
    const service = configServiceAdapter(runtime)
    const vault = vaultAdapter(runtime)
    const context = { projectPath: projectPath(args) }
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
      : await runNamedServerCommand(command, args, service, context, vault)
  } finally {
    await runtime.dispose()
  }
}
