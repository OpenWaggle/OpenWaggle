import { createHash } from 'node:crypto'
import type {
  McpJsonValue,
  McpTaskRecord,
  McpTurnSnapshot,
  McpTurnSnapshotServer,
} from '@shared/types/mcp'
import type { McpClientConnection } from './types'

const UNKNOWN_TASK_ID_DIGEST_LENGTH = 24
const TASK_RECORD_ID_LENGTH = 32

function taskObject(task: McpJsonValue) {
  return typeof task === 'object' && task !== null && !Array.isArray(task) ? task : undefined
}

function remoteTaskId(task: McpJsonValue) {
  const object = taskObject(task)
  return (
    (typeof object?.taskId === 'string' ? object.taskId : undefined) ??
    (typeof object?.id === 'string' ? object.id : undefined) ??
    `unknown-${createHash('sha256')
      .update(JSON.stringify(task))
      .digest('hex')
      .slice(0, UNKNOWN_TASK_ID_DIGEST_LENGTH)}`
  )
}

export function remoteTaskSchemaHash(connection: McpClientConnection) {
  return createHash('sha256')
    .update(
      JSON.stringify({
        protocolVersion: connection.negotiatedProtocolVersion,
        capabilities: [...connection.capabilities].sort(),
      }),
    )
    .digest('hex')
}

export function createRemoteTaskRecords(input: {
  readonly snapshot: McpTurnSnapshot
  readonly server: McpTurnSnapshotServer
  readonly connection: McpClientConnection
  readonly tasks: readonly McpJsonValue[]
  readonly now: () => number
}): readonly McpTaskRecord[] {
  return input.tasks.map((task) => {
    const object = taskObject(task)
    const taskId = remoteTaskId(task)
    const progress = typeof object?.progress === 'number' ? object.progress : undefined
    const schemaHash = remoteTaskSchemaHash(input.connection)
    return {
      id: createHash('sha256')
        .update(
          [
            input.server.instanceId,
            input.server.configHash,
            input.connection.negotiatedProtocolVersion,
            schemaHash,
            taskId,
          ].join('\0'),
        )
        .digest('base64url')
        .slice(0, TASK_RECORD_ID_LENGTH),
      remoteTaskId: taskId,
      serverInstanceId: input.server.instanceId,
      serverLabel: input.server.name,
      sessionId: input.snapshot.sessionId,
      projectPath: input.snapshot.projectPath,
      protocolVersion: input.connection.negotiatedProtocolVersion,
      configHash: input.server.configHash,
      schemaHash,
      status: typeof object?.status === 'string' ? object.status : 'unknown',
      ...(progress === undefined ? {} : { progress }),
      updatedAt: input.now(),
      disabled: false,
      provenance: {
        sourcePath: input.server.sourcePath,
        serverInstanceId: input.server.instanceId,
        serverLabel: input.server.name,
      },
      task,
    }
  })
}
