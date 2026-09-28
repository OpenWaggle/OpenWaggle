import { createHash } from 'node:crypto'
import { canonicalJson } from '@shared/canonical-json'
import { MCP_CONFIG } from '@shared/constants/mcp'
import type { McpTurnSnapshot, McpTurnSnapshotServer } from '@shared/types/mcp'
import type { McpRuntimeTool } from './types'

const CACHE_KEY_VERSION = 1

/** Which server a cached tool list belongs to: its cache key and the instance to forget it by. */
export interface McpToolCatalogIdentity {
  readonly key: string
  readonly serverInstanceId: string
}

/**
 * The tool lists servers last reported, kept across Sessions and Host restarts.
 *
 * A turn registers a server's direct tools from here while the Session's own connection to that
 * server is still starting, so a first send does not wait for every server to boot. The entry is
 * only ever a stand-in: a call through a cached tool waits for the live connection and is refused
 * when the live tool is gone or its input schema changed.
 */
export interface McpToolCatalogCache {
  read(identity: McpToolCatalogIdentity): Promise<readonly McpRuntimeTool[] | undefined>
  write(identity: McpToolCatalogIdentity, tools: readonly McpRuntimeTool[]): Promise<void>
  /** Drops every list of a server, after its credentials changed or it was removed. */
  forgetServer(serverInstanceId: string): Promise<void>
  /** Drops every list, after a secret any server may use changed. */
  forgetAll(): Promise<void>
}

/**
 * The identity a cached tool list belongs to. It is the configured server in its project, not the
 * Session or the worktree it runs in: every Session of a project starts the same server the same
 * way, and a changed definition, sandbox or permission grant is a different server.
 */
export function mcpToolCatalogIdentity(
  snapshot: McpTurnSnapshot,
  server: McpTurnSnapshotServer,
): McpToolCatalogIdentity {
  const key = createHash('sha256')
    .update(
      canonicalJson({
        version: CACHE_KEY_VERSION,
        projectPath: snapshot.projectPath,
        instanceId: server.instanceId,
        configHash: server.configHash,
        allowUnsandboxed: server.allowUnsandboxed,
        permissions: server.permissions,
      }),
    )
    .digest('hex')
  return { key, serverInstanceId: server.instanceId }
}

/** A stable fingerprint of a tool list, to tell an unchanged list from a changed one. */
export function toolCatalogFingerprint(tools: readonly McpRuntimeTool[]) {
  return createHash('sha256').update(canonicalJson(tools)).digest('hex')
}

interface MemoryEntry {
  readonly serverInstanceId: string
  readonly tools: readonly McpRuntimeTool[]
  readonly fingerprint: string
  readonly storedAt: number
}

/** A bounded, process-lifetime cache: the front of the encrypted one, and the whole of it in tests. */
export class InMemoryMcpToolCatalogCache implements McpToolCatalogCache {
  private readonly entries = new Map<string, MemoryEntry>()

  constructor(private readonly now: () => number = Date.now) {}

  async read(identity: McpToolCatalogIdentity) {
    return this.get(identity.key)?.tools
  }

  async write(identity: McpToolCatalogIdentity, tools: readonly McpRuntimeTool[]) {
    this.set(identity, tools)
  }

  async forgetServer(serverInstanceId: string) {
    this.forget(serverInstanceId)
  }

  async forgetAll() {
    this.entries.clear()
  }

  /** The live entry for a key, or undefined once it has aged out. */
  get(key: string) {
    const entry = this.entries.get(key)
    if (!entry) return undefined
    if (this.now() - entry.storedAt > MCP_CONFIG.TOOL_CATALOG_RETENTION_MS) {
      this.entries.delete(key)
      return undefined
    }
    return entry
  }

  /** Stores a list and reports whether it differs from what was already held. */
  set(identity: McpToolCatalogIdentity, tools: readonly McpRuntimeTool[], storedAt = this.now()) {
    const fingerprint = toolCatalogFingerprint(tools)
    const changed = this.entries.get(identity.key)?.fingerprint !== fingerprint
    this.entries.delete(identity.key)
    this.entries.set(identity.key, {
      serverInstanceId: identity.serverInstanceId,
      tools,
      fingerprint,
      storedAt,
    })
    while (this.entries.size > MCP_CONFIG.TOOL_CATALOG_MAX_ENTRIES) {
      const oldest = this.entries.keys().next()
      if (oldest.done) break
      this.entries.delete(oldest.value)
    }
    return changed
  }

  forget(serverInstanceId: string) {
    for (const [key, entry] of this.entries) {
      if (entry.serverInstanceId === serverInstanceId) this.entries.delete(key)
    }
  }
}
