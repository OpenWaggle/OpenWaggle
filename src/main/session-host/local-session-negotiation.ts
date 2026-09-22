import {
  LOCAL_SESSION_CAPABILITIES,
  LOCAL_SESSION_PROTOCOL_NAME,
  LOCAL_SESSION_SUPPORTED_REVISIONS,
  type LocalSessionClientHello,
  type LocalSessionNegotiationResult,
} from '@shared/types/local-session-protocol'

export function negotiateLocalSessionProtocol(
  hello: LocalSessionClientHello,
  hostInstanceId: string,
  blockers: {
    readonly blockingRuns: readonly { readonly sessionId: string; readonly runId: string }[]
    readonly blockingOperations: readonly {
      readonly operationId: string
      readonly operation: string
      readonly targetScope: string
    }[]
  } = { blockingRuns: [], blockingOperations: [] },
): LocalSessionNegotiationResult {
  const revision = LOCAL_SESSION_SUPPORTED_REVISIONS.find((candidate) =>
    hello.supportedRevisions.includes(candidate),
  )
  if (!revision) {
    const newestClientRevision = Math.max(...hello.supportedRevisions)
    if (newestClientRevision > LOCAL_SESSION_SUPPORTED_REVISIONS[0]) {
      return {
        accepted: false,
        protocol: LOCAL_SESSION_PROTOCOL_NAME,
        code: 'host_upgrade_pending',
        hostInstanceId,
        supportedRevisions: LOCAL_SESSION_SUPPORTED_REVISIONS,
        ...blockers,
      }
    }
    return {
      accepted: false,
      protocol: LOCAL_SESSION_PROTOCOL_NAME,
      code: 'incompatible_protocol',
      supportedRevisions: LOCAL_SESSION_SUPPORTED_REVISIONS,
    }
  }
  return {
    accepted: true,
    protocol: LOCAL_SESSION_PROTOCOL_NAME,
    revision,
    hostInstanceId,
    capabilities: LOCAL_SESSION_CAPABILITIES,
  }
}
