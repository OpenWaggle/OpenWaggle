import path from 'node:path'
import {
  MCP_REGISTRY_PACKAGE_TYPES,
  type McpRegistryInstallMethod,
  type McpRegistryInstallOptionView,
  type McpRegistryPackageType,
  type McpRegistryServerView,
} from '@shared/types/mcp-registry'
import { isRecord } from '@shared/utils/validation'
import type { McpRegistryEntry } from '../../../ports/mcp-registry-service'
import { piServerName } from '../import/import-identity'
import type { RegistryServerRecord } from './registry-client'
import type { OciImageResolver } from './registry-oci-resolver'
import { createRegistryPackageLauncher } from './registry-package-launchers'
import type { RegistryResourceFetcher } from './registry-secure-download'
import {
  arrayValue,
  declaredRegistryValues,
  referencedSecrets,
  stringValue,
} from './registry-values'

/** Turns a Registry server into an ordinary Pi `mcpServers` entry (ADR 0050). */

type RegistryRecord = Readonly<Record<string, unknown>>

interface RegistryRemote {
  readonly url: string
  readonly type: 'streamable-http' | 'sse'
  readonly headers: unknown
}

export function mcpRegistryPackageType(value: unknown): McpRegistryPackageType | undefined {
  return MCP_REGISTRY_PACKAGE_TYPES.find((candidate) => candidate === value)
}

function remotes(server: RegistryServerRecord): RegistryRemote[] {
  return arrayValue(server.raw.remotes).flatMap((candidate: unknown) => {
    if (!isRecord(candidate)) return []
    const url = stringValue(candidate.url)
    const type =
      candidate.type === 'sse' || candidate.type === 'streamable-http' ? candidate.type : undefined
    // A URL with `{variables}` needs values the user types in; it is left to `mcp add`.
    return url && type && !url.includes('{') ? [{ url, type, headers: candidate.headers }] : []
  })
}

function stdioPackages(server: RegistryServerRecord) {
  return arrayValue(server.raw.packages).flatMap((candidate: unknown) => {
    if (!isRecord(candidate) || !stringValue(candidate.identifier)) return []
    const type = mcpRegistryPackageType(candidate.registryType)
    const stdio = isRecord(candidate.transport) && candidate.transport.type === 'stdio'
    return type && stdio ? [{ type, entry: candidate }] : []
  })
}

function packageTarget(entry: RegistryRecord) {
  const identifier = stringValue(entry.identifier) ?? ''
  const version = stringValue(entry.version)
  return version ? `${identifier}@${version}` : identifier
}

/** The last segment of the Registry name (`io.github.acme/weather` → `weather`). */
export function suggestedServerName(server: RegistryServerRecord) {
  return piServerName(server.name.split('/').at(-1) ?? server.name)
}

export function registryServerView(server: RegistryServerRecord): McpRegistryServerView {
  const installOptions: McpRegistryInstallOptionView[] = [
    ...remotes(server).map((remote) => ({
      method: 'remote' as const,
      target: remote.url,
    })),
    ...stdioPackages(server).map(({ type, entry }) => ({
      method: type,
      target: packageTarget(entry),
    })),
  ]
  return {
    name: server.name,
    version: server.version,
    ...(server.title ? { title: server.title } : {}),
    ...(server.description ? { description: server.description } : {}),
    ...(server.repositoryUrl ? { repositoryUrl: server.repositoryUrl } : {}),
    suggestedName: suggestedServerName(server),
    installOptions,
  }
}

function remoteEntry(remote: RegistryRemote) {
  const headers = declaredRegistryValues(remote.headers, 'header')
  return {
    entry: {
      url: remote.url,
      ...(remote.type === 'sse' ? { type: 'sse' } : {}),
      ...(headers ? { headers } : {}),
    },
    secrets: referencedSecrets(headers),
  }
}

export interface RegistryEntryOptions {
  readonly method?: McpRegistryInstallMethod
  /** OpenWaggle's data directory for verified MCPB bundles (`~/.openwaggle/mcp/registry-cache`). */
  readonly cacheRoot: string
  readonly homeDir: string
  readonly fetchResource?: RegistryResourceFetcher
  readonly resolveOciImage?: OciImageResolver
}

async function packageEntry(server: RegistryServerRecord, options: RegistryEntryOptions) {
  const requested = options.method === 'remote' ? undefined : options.method
  const selected = stdioPackages(server).find(({ type }) => !requested || type === requested)
  if (!selected) {
    throw new Error(
      requested
        ? `Registry server ${server.name} has no ${requested} package that runs over stdio.`
        : `Registry server ${server.name} has no hosted URL or package OpenWaggle can run.`,
    )
  }
  const launcher = await createRegistryPackageLauncher({
    type: selected.type,
    entry: selected.entry,
    cacheRoot: options.cacheRoot,
    homeDir: options.homeDir,
    ...(options.fetchResource ? { fetchResource: options.fetchResource } : {}),
    ...(options.resolveOciImage ? { resolveOciImage: options.resolveOciImage } : {}),
  })
  return {
    entry: {
      command: launcher.command,
      ...(launcher.args.length > 0 ? { args: [...launcher.args] } : {}),
      ...(launcher.cwd ? { cwd: launcher.cwd } : {}),
      ...(launcher.env ? { env: { ...launcher.env } } : {}),
    },
    secrets: referencedSecrets(launcher.env),
  }
}

/**
 * The entry to save for `server`: its hosted URL unless `method` names a package, else the
 * first package that runs over stdio. Nothing about the Registry is written into it except the
 * description.
 */
export async function createRegistryEntry(
  server: RegistryServerRecord,
  options: RegistryEntryOptions,
): Promise<McpRegistryEntry> {
  const remote =
    options.method === undefined || options.method === 'remote' ? remotes(server)[0] : undefined
  if (options.method === 'remote' && !remote) {
    throw new Error(`Registry server ${server.name} has no hosted URL.`)
  }
  const built = remote ? remoteEntry(remote) : await packageEntry(server, options)
  return {
    suggestedName: suggestedServerName(server),
    entry: {
      ...built.entry,
      ...(server.description ? { description: server.description } : {}),
    },
    secrets: built.secrets,
  }
}

/** `~/.openwaggle/mcp/registry-cache`, where verified MCPB bundles are unpacked. */
export function registryCacheRoot(homeDir: string) {
  return path.join(homeDir, '.openwaggle', 'mcp', 'registry-cache')
}
