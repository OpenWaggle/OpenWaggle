import type { ServerTaskRecord } from './openwaggle-mcp-task-store'

export interface ActiveServerTask {
  readonly controller: AbortController
  sessionId?: string
  completion?: Promise<void>
}

export function taskResult(record: ServerTaskRecord) {
  return {
    id: record.id,
    status: record.status,
    projectPath: record.projectPath,
    model: record.model,
    delegationDepth: record.delegationDepth ?? 0,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    ...(record.parentSessionId ? { parentSessionId: record.parentSessionId } : {}),
    ...(record.sessionId ? { sessionId: record.sessionId } : {}),
    ...(record.result === undefined ? {} : { result: record.result }),
    ...(record.error ? { error: record.error } : {}),
    ...(record.action ? { action: record.action } : {}),
    ...(record.cancellationRequestedAt === undefined
      ? {}
      : { cancellationRequestedAt: record.cancellationRequestedAt }),
  }
}
