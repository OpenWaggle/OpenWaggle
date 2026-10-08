/**
 * Optional migration of OAuth sign-ins kept by the old OpenWaggle MCP client
 * (encrypted vault secret `oauth.<instanceId>`) into Pi's `McpOAuthState`,
 * keyed `<mcpNamespace(name)>|<url>` like Pi's credential store.
 *
 * Only states that map faithfully are migrated: one authorization server
 * (issuer) holding both the client registration and the tokens. Older states
 * keep a registration and tokens per issuer, which Pi's single-server state
 * cannot represent; those are skipped and the user signs in again.
 */

import { decodeUnknownOrThrow, Schema } from '@shared/schema'
import type { Logger } from '@shared/types/logger'
import { isRecord } from '@shared/utils/validation'
import type { McpFileSources } from './file-computation'
import { legacyServerIdentityKey } from './legacy-pi-import'
import { type LegacyStateFile, legacyServerMap } from './legacy-state'
import { globalMcpPaths, projectMcpPaths } from './migration-paths'
import type { McpMigrationRecord } from './migration-record'

/** Pi's `McpOAuthState` (pi-mcp `oauth/provider.d.ts`), the fields this migration fills. */
export interface MigratedMcpOAuthState {
  readonly serverUrl: string
  readonly clientInformation: Record<string, unknown>
  readonly tokens: Record<string, unknown>
}

/** The old sign-in is in the vault every build shared, sealed by another build's key. */
export const SIGN_IN_OF_ANOTHER_BUILD = Symbol('sign-in of another build')

export interface McpOAuthMigrationSink {
  /**
   * Which build migrates: the record keeps each build's outcomes apart, since each build has its own
   * sign-in store and only the build whose key sealed an old sign-in can move it.
   */
  readonly buildKey?: string
  /**
   * The old vault secret's plaintext; undefined when no build stored it; `SIGN_IN_OF_ANOTHER_BUILD`
   * when it is there but this build cannot decrypt it.
   */
  readOld(name: string): Promise<string | undefined | typeof SIGN_IN_OF_ANOTHER_BUILD>
  /**
   * Store a state in OpenWaggle's Pi OAuth store under Pi's key. False when the key already has a
   * sign-in, which is kept.
   */
  write(key: string, state: MigratedMcpOAuthState): boolean | void | Promise<boolean | void>
}

export interface McpOAuthMigrationResult {
  readonly server: string
  readonly key: string
  readonly status: 'migrated' | 'skipped' | 'already-migrated' | 'failed'
  readonly reason?: string
}

const looseRecord = Schema.Record({ key: Schema.String, value: Schema.Unknown })

const legacyTokensSchema = Schema.Struct(
  {
    access_token: Schema.String,
    token_type: Schema.String,
    expires_in: Schema.optional(Schema.Union(Schema.Number, Schema.NumberFromString)),
  },
  looseRecord,
)

const legacyClientSchema = Schema.Struct({ client_id: Schema.String }, looseRecord)

const legacyOAuthStateSchema = Schema.Struct({
  version: Schema.Literal(1),
  tokensByIssuer: Schema.Record({ key: Schema.String, value: legacyTokensSchema }),
  clientsByIssuer: Schema.Record({ key: Schema.String, value: legacyClientSchema }),
  lastTokenIssuer: Schema.optional(Schema.String),
})

/** Pi's `mcpNamespace` (core/mcp-servers.js). */
function mcpNamespace(server: string) {
  return `mcp__${server.replace(/-/g, '_')}`
}

/** Pi's credential-store key for a server (extensions/mcp/oauth.js `storeKeys`). */
export function piOAuthStateKey(name: string, url: string) {
  return `${mcpNamespace(name)}|${String(new URL(url))}`
}

/** The old provider stamped `issuer` onto stored values; Pi's state has no such field. */
function withoutIssuer(value: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'issuer'))
}

type OAuthMapping =
  | { readonly kind: 'state'; readonly state: MigratedMcpOAuthState }
  | { readonly kind: 'skip'; readonly reason: string }

/** Map one old OAuth state to Pi's, or explain why it cannot be mapped faithfully. */
export function mapLegacyOAuthState(rawJson: string, serverUrl: string): OAuthMapping {
  const parsed: unknown = JSON.parse(rawJson)
  const state = decodeUnknownOrThrow(legacyOAuthStateSchema, parsed)
  const issuers = new Set([
    ...Object.keys(state.tokensByIssuer),
    ...Object.keys(state.clientsByIssuer),
  ])
  if (issuers.size > 1) {
    return { kind: 'skip', reason: 'the sign-in spans several authorization servers' }
  }
  const issuer = state.lastTokenIssuer ?? [...issuers][0]
  const tokens = issuer === undefined ? undefined : state.tokensByIssuer[issuer]
  const client = issuer === undefined ? undefined : state.clientsByIssuer[issuer]
  if (!tokens) return { kind: 'skip', reason: 'no tokens are stored' }
  if (!client) return { kind: 'skip', reason: 'the client registration for the tokens is missing' }
  return {
    kind: 'state',
    state: {
      serverUrl: String(new URL(serverUrl)),
      clientInformation: withoutIssuer(client),
      tokens: withoutIssuer(tokens),
    },
  }
}

interface OAuthCandidate {
  readonly name: string
  readonly url: string
  readonly instanceId: string
}

async function oauthCandidates(input: {
  readonly sources: McpFileSources
  readonly state: LegacyStateFile
  readonly projects: readonly string[]
}) {
  const global = globalMcpPaths(input.sources.homeDir, input.sources.piAgentDir)
  const files = [
    {
      path: global.openwaggleGlobal,
      config: await input.sources.legacyConfig(global.openwaggleGlobal),
    },
  ]
  for (const projectPath of input.projects) {
    const project = projectMcpPaths(projectPath)
    files.push(
      { path: project.mcpJson, config: await input.sources.readOnlyConfig(project.mcpJson) },
      { path: project.openwaggle, config: await input.sources.legacyConfig(project.openwaggle) },
    )
  }
  const candidates: OAuthCandidate[] = []
  for (const file of files) {
    if (!file.config) continue
    for (const [name, entry] of Object.entries(legacyServerMap(file.config))) {
      const serverState = input.state.servers[legacyServerIdentityKey(file.path, name)]
      if (!isRecord(entry) || typeof entry.url !== 'string' || !serverState) continue
      candidates.push({ name, url: entry.url, instanceId: serverState.instanceId })
    }
  }
  return candidates
}

function describeError(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

export async function migrateLegacyOAuthStates(input: {
  readonly sources: McpFileSources
  readonly state: LegacyStateFile
  readonly projects: readonly string[]
  readonly record: McpMigrationRecord
  readonly sink: McpOAuthMigrationSink
  readonly now: () => Date
  readonly logger: Logger
}): Promise<McpOAuthMigrationResult[]> {
  const results: McpOAuthMigrationResult[] = []
  let candidates: OAuthCandidate[]
  try {
    candidates = await oauthCandidates(input)
  } catch (error) {
    input.logger.error('MCP OAuth migration could not read the old MCP files', {
      error: describeError(error),
    })
    return results
  }
  const seen = new Set<string>()
  for (const candidate of candidates) {
    if (!URL.canParse(candidate.url)) continue
    const key = piOAuthStateKey(candidate.name, candidate.url)
    if (seen.has(key)) continue
    seen.add(key)
    if (input.record.isOAuthHandled(recordKey(input.sink, key))) {
      results.push({ server: candidate.name, key, status: 'already-migrated' })
      continue
    }
    results.push(await migrateOne(input, candidate, key))
  }
  return results
}

/** The record's key for one sign-in: Pi's key, under the build that handled it. */
function recordKey(sink: McpOAuthMigrationSink, key: string) {
  return sink.buildKey === undefined ? key : `${sink.buildKey}\u0000${key}`
}

async function migrateOne(
  input: Parameters<typeof migrateLegacyOAuthStates>[0],
  candidate: OAuthCandidate,
  key: string,
): Promise<McpOAuthMigrationResult> {
  try {
    const raw = await input.sink.readOld(`oauth.${candidate.instanceId}`)
    const migratedAt = input.now().toISOString()
    const recorded = recordKey(input.sink, key)
    if (raw === SIGN_IN_OF_ANOTHER_BUILD) {
      // Not recorded: it is the other build's to move, and this one looks again on a later start.
      return {
        server: candidate.name,
        key,
        status: 'skipped',
        reason: 'signed in in another build',
      }
    }
    if (raw === undefined) {
      // Recorded, so later runs do not read the vault again; a failed read is not recorded.
      const reason = 'not signed in'
      await input.record.recordOAuth(recorded, { migratedAt, status: 'skipped', reason })
      return { server: candidate.name, key, status: 'skipped', reason }
    }
    const mapping = mapLegacyOAuthState(raw, candidate.url)
    if (mapping.kind === 'skip') {
      await input.record.recordOAuth(recorded, {
        migratedAt,
        status: 'skipped',
        reason: mapping.reason,
      })
      return { server: candidate.name, key, status: 'skipped', reason: mapping.reason }
    }
    if ((await input.sink.write(key, mapping.state)) === false) {
      const reason = 'already signed in'
      await input.record.recordOAuth(recorded, { migratedAt, status: 'skipped', reason })
      return { server: candidate.name, key, status: 'skipped', reason }
    }
    await input.record.recordOAuth(recorded, { migratedAt, status: 'migrated' })
    return { server: candidate.name, key, status: 'migrated' }
  } catch (error) {
    input.logger.error('MCP OAuth migration failed for a server', {
      server: candidate.name,
      error: describeError(error),
    })
    return { server: candidate.name, key, status: 'failed', reason: describeError(error) }
  }
}
