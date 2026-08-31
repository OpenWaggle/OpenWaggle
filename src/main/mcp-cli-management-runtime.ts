import { LOCAL_SESSION_CURRENT_REVISION } from '@shared/types/local-session-protocol'
import type { McpSecretSummary } from '@shared/types/mcp'
import { Effect, Layer, ManagedRuntime } from 'effect'
import { EncryptedMcpSecretVaultServiceLive } from './adapters/mcp/encrypted-mcp-secret-vault-service'
import { FilesystemMcpConfigServiceLive } from './adapters/mcp/filesystem-mcp-config-service'
import { McpTurnStateServiceLive } from './adapters/mcp/mcp-turn-state-service'
import type { createFilesystemMcpConfigService } from './adapters/mcp/service-factory'
import { reconcileMcpOwnerRuntime } from './application/mcp-owner-runtime-reconciliation'
import { createLocalSessionCliClientInput } from './local-session-cli-client'
import type { ParsedArguments } from './mcp-cli-arguments'
import { McpConfigService } from './ports/mcp-config-service'
import { McpSecretVaultService } from './ports/mcp-secret-vault-service'

export type McpCliConfigService = ReturnType<typeof createFilesystemMcpConfigService>

export interface McpCliVault {
  list(): Promise<readonly McpSecretSummary[]>
  resolve(name: string): Promise<string>
  set(name: string, value: string): Promise<readonly McpSecretSummary[]>
  remove(name: string): Promise<readonly McpSecretSummary[]>
}

const McpManagementLayer = Layer.mergeAll(
  FilesystemMcpConfigServiceLive,
  EncryptedMcpSecretVaultServiceLive,
).pipe(Layer.provide(McpTurnStateServiceLive))

async function mutateAndReconcile<A>(
  mutation: Promise<A>,
  reconcileOwnerRuntime: () => Promise<void>,
) {
  const result = await mutation
  await reconcileOwnerRuntime()
  return result
}

function configServiceAdapter(
  runtime: ManagedRuntime.ManagedRuntime<McpConfigService, never>,
  reconcileOwnerRuntime: () => Promise<void>,
) {
  return {
    getServerDefinition: (input) =>
      runtime.runPromise(
        McpConfigService.pipe(Effect.flatMap((service) => service.getServerDefinition(input))),
      ),
    getView: (input) =>
      runtime.runPromise(
        McpConfigService.pipe(Effect.flatMap((service) => service.getView(input))),
      ),
    setScopeState: (input) =>
      mutateAndReconcile(
        runtime.runPromise(
          McpConfigService.pipe(Effect.flatMap((service) => service.setScopeState(input))),
        ),
        reconcileOwnerRuntime,
      ),
    setServerEnabled: (input) =>
      mutateAndReconcile(
        runtime.runPromise(
          McpConfigService.pipe(Effect.flatMap((service) => service.setServerEnabled(input))),
        ),
        reconcileOwnerRuntime,
      ),
    setProjectServerEnabled: (input) =>
      mutateAndReconcile(
        runtime.runPromise(
          McpConfigService.pipe(
            Effect.flatMap((service) => service.setProjectServerEnabled(input)),
          ),
        ),
        reconcileOwnerRuntime,
      ),
    setServerTrust: (input) =>
      mutateAndReconcile(
        runtime.runPromise(
          McpConfigService.pipe(Effect.flatMap((service) => service.setServerTrust(input))),
        ),
        reconcileOwnerRuntime,
      ),
    writeSourceConfig: (input) =>
      mutateAndReconcile(
        runtime.runPromise(
          McpConfigService.pipe(Effect.flatMap((service) => service.writeSourceConfig(input))),
        ),
        reconcileOwnerRuntime,
      ),
    removeServer: (input) =>
      mutateAndReconcile(
        runtime.runPromise(
          McpConfigService.pipe(Effect.flatMap((service) => service.removeServer(input))),
        ),
        reconcileOwnerRuntime,
      ),
    addServer: (input) =>
      mutateAndReconcile(
        runtime.runPromise(
          McpConfigService.pipe(Effect.flatMap((service) => service.addServer(input))),
        ),
        reconcileOwnerRuntime,
      ),
    previewImports: (input) =>
      runtime.runPromise(
        McpConfigService.pipe(Effect.flatMap((service) => service.previewImports(input))),
      ),
    applyImports: (input) =>
      mutateAndReconcile(
        runtime.runPromise(
          McpConfigService.pipe(Effect.flatMap((service) => service.applyImports(input))),
        ),
        reconcileOwnerRuntime,
      ),
    createTurnSnapshot: (input) =>
      runtime.runPromise(
        McpConfigService.pipe(Effect.flatMap((service) => service.createTurnSnapshot(input))),
      ),
  } satisfies McpCliConfigService
}

function vaultAdapter(
  runtime: ManagedRuntime.ManagedRuntime<McpSecretVaultService, never>,
  reconcileOwnerRuntime: () => Promise<void>,
): McpCliVault {
  return {
    list: () =>
      runtime.runPromise(McpSecretVaultService.pipe(Effect.flatMap((vault) => vault.list()))),
    resolve: (name) =>
      runtime.runPromise(
        McpSecretVaultService.pipe(Effect.flatMap((vault) => vault.resolve(name))),
      ),
    set: (name, value) =>
      mutateAndReconcile(
        runtime.runPromise(
          McpSecretVaultService.pipe(Effect.flatMap((vault) => vault.set({ name, value }))),
        ),
        reconcileOwnerRuntime,
      ),
    remove: (name) =>
      mutateAndReconcile(
        runtime.runPromise(
          McpSecretVaultService.pipe(Effect.flatMap((vault) => vault.remove({ name }))),
        ),
        reconcileOwnerRuntime,
      ),
  }
}

export async function reconcileOwningMcpHost(args: ParsedArguments, project: string) {
  const client = await createLocalSessionCliClientInput(args, {
    supportedRevisions: [LOCAL_SESSION_CURRENT_REVISION],
  })
  await reconcileMcpOwnerRuntime(client, project)
}

export function createMcpCliManagementRuntime(reconcileOwnerRuntime: () => Promise<void>) {
  const runtime = ManagedRuntime.make(McpManagementLayer)
  return {
    service: configServiceAdapter(runtime, reconcileOwnerRuntime),
    vault: vaultAdapter(runtime, reconcileOwnerRuntime),
    dispose: () => runtime.dispose(),
  }
}
