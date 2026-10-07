import { isRecord } from '@shared/utils/validation'
import {
  fetchBoundedRegistryResource,
  type RegistryResourceFetcher,
} from './registry-secure-download'
import { arrayValue, stringValue } from './registry-values'

/** The official MCP Registry. Another registry with the same API can be named per request. */
export const DEFAULT_MCP_REGISTRY_URL = 'https://registry.modelcontextprotocol.io'
const REGISTRY_RESPONSE_LIMIT_BYTES = 2_000_000
/** The public Registry sometimes takes over 10 seconds to answer a search. */
const REGISTRY_TIMEOUT_MS = 30_000
const DEFAULT_REGISTRY_RESULT_LIMIT = 20
const MAX_REGISTRY_RESULT_LIMIT = 100

/** One server version as the Registry describes it (`server.json`). */
export interface RegistryServerRecord {
  readonly name: string
  readonly title?: string
  readonly description?: string
  readonly version: string
  readonly repositoryUrl?: string
  readonly raw: Readonly<Record<string, unknown>>
}

export interface RegistryClientOptions {
  readonly registryUrl?: string
  readonly fetchResource?: RegistryResourceFetcher
}

function registryBaseUrl(value = DEFAULT_MCP_REGISTRY_URL) {
  const url = new URL(value)
  const loopback =
    url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]'
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new Error('MCP registry URLs require HTTPS except for an explicit loopback registry.')
  }
  return url
}

async function fetchRegistryJson(url: URL, options: RegistryClientOptions) {
  const raw = await fetchBoundedRegistryResource({
    url,
    limitBytes: REGISTRY_RESPONSE_LIMIT_BYTES,
    timeoutMs: REGISTRY_TIMEOUT_MS,
    accept: 'application/json',
    ...(options.fetchResource ? { fetchResource: options.fetchResource } : {}),
  })
  try {
    const payload: unknown = JSON.parse(raw.toString('utf8'))
    return payload
  } catch {
    throw new Error('MCP registry returned invalid JSON.')
  }
}

function serverRecord(value: unknown): RegistryServerRecord | null {
  if (!isRecord(value)) return null
  const wrapped = isRecord(value.server) ? value.server : value
  const name = stringValue(wrapped.name)
  const version = stringValue(wrapped.version)
  if (!name || !version) return null
  const repository = isRecord(wrapped.repository) ? wrapped.repository : undefined
  const title = stringValue(wrapped.title)
  const description = stringValue(wrapped.description)
  const repositoryUrl = stringValue(repository?.url)
  return {
    name,
    version,
    ...(title ? { title } : {}),
    ...(description ? { description } : {}),
    ...(repositoryUrl ? { repositoryUrl } : {}),
    raw: wrapped,
  }
}

function isLatest(value: unknown) {
  if (!isRecord(value) || !isRecord(value._meta)) return false
  const official = value._meta['io.modelcontextprotocol.registry/official']
  return isRecord(official) && official.isLatest === true
}

function resultLimit(limit: number | undefined) {
  return Math.min(Math.max(limit ?? DEFAULT_REGISTRY_RESULT_LIMIT, 1), MAX_REGISTRY_RESULT_LIMIT)
}

/** Servers whose name matches `query`, latest versions only when the Registry marks them. */
export async function searchMcpRegistry(
  input: { readonly query: string; readonly limit?: number } & RegistryClientOptions,
) {
  const url = new URL('/v0.1/servers', registryBaseUrl(input.registryUrl))
  url.searchParams.set('search', input.query)
  url.searchParams.set('limit', String(resultLimit(input.limit)))
  const payload = await fetchRegistryJson(url, input)
  if (!isRecord(payload) || !Array.isArray(payload.servers)) {
    throw new Error('MCP registry returned an invalid server list.')
  }
  const all = arrayValue(payload.servers).flatMap((entry: unknown) => {
    const server = serverRecord(entry)
    return server ? [{ server, latest: isLatest(entry) }] : []
  })
  const latest = all.filter((entry) => entry.latest)
  return (latest.length > 0 ? latest : all).map((entry) => entry.server)
}

export class McpRegistryServerNotFoundError extends Error {}

/** One server: an exact version, or the latest one found by searching for its name. */
export async function getMcpRegistryServer(
  input: { readonly name: string; readonly version?: string } & RegistryClientOptions,
) {
  if (!input.version) {
    const candidates = await searchMcpRegistry({
      ...input,
      query: input.name,
      limit: MAX_REGISTRY_RESULT_LIMIT,
    })
    const exact = candidates.find((candidate) => candidate.name === input.name)
    if (!exact) {
      throw new McpRegistryServerNotFoundError(
        `MCP registry server ${JSON.stringify(input.name)} was not found.`,
      )
    }
    return exact
  }
  const url = new URL(
    `/v0.1/servers/${encodeURIComponent(input.name)}/versions/${encodeURIComponent(input.version)}`,
    registryBaseUrl(input.registryUrl),
  )
  const server = serverRecord(await fetchRegistryJson(url, input))
  if (!server) throw new Error('MCP registry returned invalid server metadata.')
  return server
}
