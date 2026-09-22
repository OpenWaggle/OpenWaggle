import type { McpRuntimeNotice } from '@shared/types/mcp'
import { plaintextSecretLikeKeys } from '../../domain/mcp/server-policy'
import type { LoadedMcpContext } from './config-view'
import { blockedReason, trustState } from './config-view'

/** ADR-0035 notices: invalid parse, ignored fields, plaintext secrets, trust changes, blockers. */
export function buildNotices(context: LoadedMcpContext, effectiveState: 'on' | 'off') {
  const notices: McpRuntimeNotice[] = []
  for (const source of context.sources) {
    if (source.parseError) {
      notices.push({
        id: `source:${source.definition.id}:parse`,
        severity: 'error',
        title: `${source.definition.label} is invalid`,
        detail: source.parseError,
        action: 'Fix the JSON before enabling MCP for this scope.',
      })
    }
    if (source.ignoredFields.length > 0) {
      notices.push({
        id: `source:${source.definition.id}:ignored`,
        severity: 'warning',
        title: `${source.definition.label} contains ignored fields`,
        detail: source.ignoredFields.join(', '),
        action: 'Review the fields; OpenWaggle preserves them but does not apply them.',
      })
    }
    if (source.definition.kind === 'openwaggle') {
      const plaintextKeys = Object.values(source.servers).flatMap((server) =>
        plaintextSecretLikeKeys(server),
      )
      if (plaintextKeys.length > 0) {
        notices.push({
          id: `source:${source.definition.id}:plaintext-secrets`,
          severity: 'info',
          title: `${source.definition.label} contains plaintext secret-like values`,
          detail: plaintextKeys.join(', '),
          action: 'Optional: store these in the secret vault and reference them for safer storage.',
        })
      }
    }
  }
  for (const server of context.servers) {
    if (trustState(server) === 'invalidated') {
      notices.push({
        id: `server:${server.state.instanceId}:changed`,
        severity: 'info',
        title: `${server.name} configuration changed`,
        detail:
          'The server configuration changed since approval; it reconnects with derived grants on the next turn.',
        action: 'Re-approve to bind trust to the new configuration.',
        serverInstanceId: server.state.instanceId,
      })
    }
    const blocked = blockedReason(server, effectiveState)
    if (!blocked || (!server.state.enabled && !server.definition.required)) continue
    notices.push({
      id: `server:${server.state.instanceId}:blocked`,
      severity: server.definition.required ? 'error' : 'warning',
      title: `${server.name} cannot start`,
      detail: blocked,
      action: 'Review enablement, trust, configuration, credentials, and sandbox grants.',
      serverInstanceId: server.state.instanceId,
    })
  }
  return notices
}
