import { homedir } from 'node:os'
import { Effect, Layer } from 'effect'
import { McpConfigurationError } from '../../../ports/mcp-configuration-service'
import {
  McpRegistryService,
  type McpRegistryServiceShape,
} from '../../../ports/mcp-registry-service'
import {
  getMcpRegistryServer,
  McpRegistryServerNotFoundError,
  searchMcpRegistry,
} from './registry-client'
import { createRegistryEntry, registryCacheRoot, registryServerView } from './registry-entry'
import type { OciImageResolver } from './registry-oci-resolver'
import type { RegistryResourceFetcher } from './registry-secure-download'

export interface McpRegistryServiceOptions {
  readonly homeDir: string
  readonly fetchResource?: RegistryResourceFetcher
  readonly resolveOciImage?: OciImageResolver
}

function failure(error: unknown) {
  return new McpConfigurationError({
    reason: error instanceof McpRegistryServerNotFoundError ? 'not-found' : 'io',
    message: error instanceof Error ? error.message : String(error),
  })
}

function attempt<A>(run: () => Promise<A>) {
  return Effect.tryPromise({ try: run, catch: failure })
}

export function createMcpRegistryService(
  options: McpRegistryServiceOptions,
): McpRegistryServiceShape {
  const client = options.fetchResource ? { fetchResource: options.fetchResource } : {}
  const getServer = (input: Parameters<McpRegistryServiceShape['getServer']>[0]) =>
    getMcpRegistryServer({
      ...client,
      name: input.registryName,
      ...(input.version ? { version: input.version } : {}),
      ...(input.registryUrl ? { registryUrl: input.registryUrl } : {}),
    })
  return {
    search: (input) =>
      attempt(async () => ({
        servers: (await searchMcpRegistry({ ...client, ...input })).map(registryServerView),
      })),
    getServer: (input) => attempt(async () => registryServerView(await getServer(input))),
    prepareEntry: (input) =>
      attempt(async () =>
        createRegistryEntry(await getServer(input), {
          ...client,
          cacheRoot: registryCacheRoot(options.homeDir),
          homeDir: options.homeDir,
          ...(input.method ? { method: input.method } : {}),
          ...(options.resolveOciImage ? { resolveOciImage: options.resolveOciImage } : {}),
        }),
      ),
  }
}

export const McpRegistryServiceLive = Layer.sync(McpRegistryService, () =>
  McpRegistryService.of(createMcpRegistryService({ homeDir: homedir() })),
)
