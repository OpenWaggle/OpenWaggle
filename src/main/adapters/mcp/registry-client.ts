import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import path from 'node:path'
import type { McpServerDefinition, McpServerProvenance } from '@shared/types/mcp'
import type { OciImageResolver } from './registry-oci-resolver'
import {
  createRegistryPackageLauncher,
  declaredRegistryCredentials,
  type McpRegistryPackageType,
} from './registry-package-launchers'
import {
  fetchBoundedRegistryResource,
  type RegistryResourceFetcher,
} from './registry-secure-download'

const DEFAULT_REGISTRY_URL = 'https://registry.modelcontextprotocol.io'
const REGISTRY_RESPONSE_LIMIT_BYTES = 2_000_000
const REGISTRY_TIMEOUT_MS = 15_000
const DEFAULT_REGISTRY_RESULT_LIMIT = 20
const MAX_REGISTRY_RESULT_LIMIT = 100

export interface McpRegistryServer {
  readonly name: string
  readonly title?: string
  readonly description?: string
  readonly version: string
  readonly repositoryUrl?: string
  readonly raw: Readonly<Record<string, unknown>>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringValue(value: unknown) {
  return typeof value === 'string' && value.trim() ? value : undefined
}

function arrayValue(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value.map((entry: unknown) => entry) : []
}

function validateRegistryUrl(value = DEFAULT_REGISTRY_URL) {
  const url = new URL(value)
  const loopback =
    url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1'
  if (url.protocol !== 'https:' && !loopback) {
    throw new Error('MCP registry URLs require HTTPS except for an explicit loopback registry.')
  }
  return url
}

async function fetchRegistryJson(url: URL, fetchResource?: RegistryResourceFetcher) {
  const raw = await fetchBoundedRegistryResource({
    url,
    limitBytes: REGISTRY_RESPONSE_LIMIT_BYTES,
    timeoutMs: REGISTRY_TIMEOUT_MS,
    accept: 'application/json',
    ...(fetchResource ? { fetchResource } : {}),
  })
  try {
    const payload: unknown = JSON.parse(raw.toString('utf8'))
    return payload
  } catch {
    throw new Error('MCP registry returned invalid JSON.')
  }
}

function normalizeRegistryServer(value: unknown): McpRegistryServer | null {
  if (!isRecord(value)) return null
  const wrapped = isRecord(value.server) ? value.server : value
  const name = stringValue(wrapped.name)
  const version = stringValue(wrapped.version)
  if (!name || !version) return null
  const repository = isRecord(wrapped.repository) ? wrapped.repository : undefined
  return {
    name,
    version,
    ...(stringValue(wrapped.title) ? { title: stringValue(wrapped.title) } : {}),
    ...(stringValue(wrapped.description) ? { description: stringValue(wrapped.description) } : {}),
    ...(stringValue(repository?.url) ? { repositoryUrl: stringValue(repository?.url) } : {}),
    raw: wrapped,
  }
}

function officialMetadata(value: unknown) {
  if (!isRecord(value) || !isRecord(value._meta)) return undefined
  const official = value._meta['io.modelcontextprotocol.registry/official']
  return isRecord(official) ? official : undefined
}

export async function searchMcpRegistry(input: {
  readonly query: string
  readonly limit?: number
  readonly registryUrl?: string
  readonly fetchResource?: RegistryResourceFetcher
}) {
  const baseUrl = validateRegistryUrl(input.registryUrl)
  const url = new URL('/v0.1/servers', baseUrl)
  url.searchParams.set('search', input.query)
  url.searchParams.set(
    'limit',
    String(
      Math.min(
        Math.max(input.limit ?? DEFAULT_REGISTRY_RESULT_LIMIT, 1),
        MAX_REGISTRY_RESULT_LIMIT,
      ),
    ),
  )
  const payload = await fetchRegistryJson(url, input.fetchResource)
  if (!isRecord(payload) || !Array.isArray(payload.servers)) {
    throw new Error('MCP registry returned an invalid server list.')
  }
  const all = arrayValue(payload.servers)
    .map((entry: unknown) => ({ entry, server: normalizeRegistryServer(entry) }))
    .filter(
      (entry): entry is { readonly entry: unknown; readonly server: McpRegistryServer } =>
        entry.server !== null,
    )
  const latest = all.filter((entry) => officialMetadata(entry.entry)?.isLatest === true)
  return (latest.length > 0 ? latest : all).map((entry) => entry.server)
}

export async function getMcpRegistryServer(input: {
  readonly name: string
  readonly version?: string
  readonly registryUrl?: string
  readonly fetchResource?: RegistryResourceFetcher
}) {
  if (!input.version) {
    const candidates = await searchMcpRegistry({
      query: input.name,
      limit: MAX_REGISTRY_RESULT_LIMIT,
      ...(input.registryUrl ? { registryUrl: input.registryUrl } : {}),
      ...(input.fetchResource ? { fetchResource: input.fetchResource } : {}),
    })
    const exact = candidates.find((candidate) => candidate.name === input.name)
    if (!exact) throw new Error(`MCP registry server ${JSON.stringify(input.name)} was not found.`)
    return exact
  }
  const baseUrl = validateRegistryUrl(input.registryUrl)
  const url = new URL(
    `/v0.1/servers/${encodeURIComponent(input.name)}/versions/${encodeURIComponent(input.version)}`,
    baseUrl,
  )
  const payload = await fetchRegistryJson(url, input.fetchResource)
  const server = normalizeRegistryServer(payload)
  if (!server) throw new Error('MCP registry returned invalid server metadata.')
  return server
}

function registryFingerprint(server: McpRegistryServer) {
  return createHash('sha256').update(JSON.stringify(server.raw)).digest('hex')
}

export function mcpRegistryPackageType(value: unknown): McpRegistryPackageType | undefined {
  if (
    value === 'npm' ||
    value === 'pypi' ||
    value === 'nuget' ||
    value === 'oci' ||
    value === 'mcpb'
  ) {
    return value
  }
  return undefined
}

function isStdioPackage(entry: Readonly<Record<string, unknown>>) {
  return isRecord(entry.transport) && entry.transport.type === 'stdio'
}

function registryProvenance(server: McpRegistryServer): McpServerProvenance {
  return {
    source: 'registry',
    fingerprint: registryFingerprint(server),
    importedAt: new Date().toISOString(),
    registryName: server.name,
    registryVersion: server.version,
  }
}

function remoteDraft(
  server: McpRegistryServer,
  provenance: McpServerProvenance,
): { readonly name: string; readonly definition: McpServerDefinition } | undefined {
  const remote = arrayValue(server.raw.remotes).find(
    (candidate: unknown) => isRecord(candidate) && typeof candidate.url === 'string',
  )
  if (!isRecord(remote)) return undefined
  const url = stringValue(remote.url)
  if (!url) throw new Error('Registry remote entry is missing its URL.')
  if (remote.type !== 'sse' && remote.type !== 'streamable-http') {
    throw new Error('Registry remote entry requires sse or streamable-http transport.')
  }
  const headers = declaredRegistryCredentials(remote.headers)
  return {
    name: server.title ?? server.name,
    definition: {
      url,
      transport: remote.type,
      ...(headers ? { headers } : {}),
      provenance,
    },
  }
}

function selectedPackage(server: McpRegistryServer, requested?: McpRegistryPackageType) {
  for (const candidate of arrayValue(server.raw.packages)) {
    if (!isRecord(candidate)) continue
    const candidateType = mcpRegistryPackageType(candidate.registryType)
    if (!candidateType || (requested && candidateType !== requested)) continue
    if (stringValue(candidate.identifier)) return candidate
  }
  throw new Error('Registry server has no supported remote or package launcher.')
}

export async function createRegistryDraft(input: {
  readonly server: McpRegistryServer
  readonly packageType?: McpRegistryPackageType
  readonly cacheRoot?: string
  readonly homeDir?: string
  readonly fetchResource?: RegistryResourceFetcher
  readonly resolveOciImage?: OciImageResolver
}): Promise<{ readonly name: string; readonly definition: McpServerDefinition }> {
  const provenance = registryProvenance(input.server)
  const remote = input.packageType ? undefined : remoteDraft(input.server, provenance)
  if (remote) return remote

  const selected = selectedPackage(input.server, input.packageType)
  const selectedType = mcpRegistryPackageType(selected.registryType)
  if (!selectedType || !isStdioPackage(selected)) {
    throw new Error('Registry package launcher requires an explicit stdio transport.')
  }
  const homeDir = input.homeDir ?? homedir()
  const launcher = await createRegistryPackageLauncher({
    type: selectedType,
    entry: selected,
    homeDir,
    cacheRoot: input.cacheRoot ?? path.join(homeDir, '.openwaggle', 'mcp', 'registry-cache'),
    ...(input.fetchResource ? { fetchResource: input.fetchResource } : {}),
    ...(input.resolveOciImage ? { resolveOciImage: input.resolveOciImage } : {}),
  })
  return {
    name: input.server.title ?? input.server.name,
    definition: {
      command: launcher.command,
      args: [...launcher.args],
      ...(launcher.cwd ? { cwd: launcher.cwd } : {}),
      ...(launcher.env ? { env: { ...launcher.env } } : {}),
      transport: 'stdio',
      provenance: {
        ...provenance,
        packageCoordinate: launcher.coordinate,
        ...(launcher.digest ? { packageDigest: launcher.digest } : {}),
      },
    },
  }
}

export type { McpRegistryPackageType }
export { DEFAULT_REGISTRY_URL }
