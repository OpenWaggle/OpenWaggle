import { Schema } from '@shared/schema'
import { anyObjectSchema } from '@shared/schemas/lenient'
import { Option } from 'effect'
import {
  fetchBoundedRegistryResource,
  type RegistryResourceFetcher,
} from './registry-secure-download'
import {
  type RegistryServer,
  registryListEntrySchema,
  registryServerListSchema,
  registryServerSchema,
} from './registry-server-schema'

const decodeServerList = Schema.decodeUnknownOption(registryServerListSchema)

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
  /** The decoded `server.json`. */
  readonly source: RegistryServer
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

const isObject = Schema.is(anyObjectSchema)
const decodeListEntry = Schema.decodeUnknownOption(registryListEntrySchema)
const decodeServer = Schema.decodeUnknownOption(registryServerSchema)

function serverRecord(value: unknown) {
  const listEntry = Option.getOrUndefined(decodeListEntry(value))
  if (!listEntry) return null
  const wrapped = isObject(listEntry.server) ? listEntry.server : value
  const source = Option.getOrUndefined(decodeServer(wrapped))
  const { name, version } = source ?? {}
  if (!source || !name || !version) return null
  const { title, description } = source
  const repositoryUrl = source.repository?.url
  const record: RegistryServerRecord | null = {
    name,
    version,
    ...(title ? { title } : {}),
    ...(description ? { description } : {}),
    ...(repositoryUrl ? { repositoryUrl } : {}),
    source,
  }
  return record
}

function isLatest(value: unknown) {
  const listEntry = Option.getOrUndefined(decodeListEntry(value))
  return listEntry?._meta?.['io.modelcontextprotocol.registry/official']?.isLatest === true
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
  const list = Option.getOrUndefined(decodeServerList(payload))
  if (!list) throw new Error('MCP registry returned an invalid server list.')
  const all = list.servers.flatMap((entry: unknown) => {
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
