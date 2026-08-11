import type {
  McpPromptResult,
  McpResourceResult,
  McpTaskOperationInput,
  McpTaskRecord,
  McpTurnSnapshot,
  McpTurnSnapshotServer,
} from '@shared/types/mcp'
import { Effect } from 'effect'
import { McpRuntimeError, type McpRuntimeFailure } from '../../../ports/mcp-errors'
import { attribution, fromConnection, isObject, values } from './capability-shared'
import { remoteTaskSchemaHash } from './remote-task-records'
import type { McpRuntimeStateService } from './runtime-state-types'
import type { McpClientConnection } from './types'

export function getMcpPrompt(input: {
  readonly state: McpRuntimeStateService
  readonly snapshot: McpTurnSnapshot
  readonly serverInstanceId: string
  readonly name: string
  readonly arguments?: Readonly<Record<string, string>>
}): Effect.Effect<McpPromptResult, McpRuntimeFailure> {
  return Effect.gen(function* () {
    const { server, connection } = yield* input.state.getConnectionForServer(
      input.snapshot,
      input.serverInstanceId,
    )
    const result = yield* fromConnection('getPrompt', () =>
      connection.getPrompt({ name: input.name, arguments: input.arguments }),
    )
    return {
      ...(isObject(result) && typeof result.description === 'string'
        ? { description: result.description }
        : {}),
      messages: isObject(result) && result.messages !== undefined ? result.messages : result,
      attribution: attribution(server),
    }
  })
}

export function readMcpResource(input: {
  readonly state: McpRuntimeStateService
  readonly snapshot: McpTurnSnapshot
  readonly serverInstanceId: string
  readonly uri: string
}): Effect.Effect<McpResourceResult, McpRuntimeFailure> {
  return Effect.gen(function* () {
    const { server, connection } = yield* input.state.getConnectionForServer(
      input.snapshot,
      input.serverInstanceId,
    )
    const result = yield* fromConnection('readResource', () =>
      connection.readResource({ uri: input.uri }),
    )
    return {
      contents: isObject(result) && result.contents !== undefined ? result.contents : result,
      attribution: attribution(server),
    }
  })
}

function operateStoredMcpTask(
  state: McpRuntimeStateService,
  input: McpTaskOperationInput,
): Effect.Effect<readonly McpTaskRecord[], McpRuntimeFailure> {
  return Effect.gen(function* () {
    const stored = yield* state.listRemoteTasks({
      projectPath: input.projectPath,
      serverInstanceId: input.serverInstanceId,
    })
    if (input.operation === 'list') return stored.map((task) => ({ ...task, disabled: true }))
    const taskId = input.taskId?.trim()
    if (!taskId)
      return yield* Effect.fail(
        new McpRuntimeError({
          operation: input.operation,
          message: `${input.operation} requires taskId.`,
        }),
      )
    const selected = stored.filter((task) => task.remoteTaskId === taskId || task.id === taskId)
    if (input.operation === 'get') return selected.map((task) => ({ ...task, disabled: true }))
    return yield* Effect.fail(
      new McpRuntimeError({
        operation: 'cancel',
        message:
          'This MCP server is disabled. The remote task may still be running; re-enable the server before requesting cancellation.',
      }),
    )
  })
}

function assertCurrentTaskIdentity(input: {
  readonly state: McpRuntimeStateService
  readonly snapshot: McpTurnSnapshot
  readonly server: McpTurnSnapshotServer
  readonly connection: McpClientConnection
  readonly taskId: string
}): Effect.Effect<void, McpRuntimeFailure> {
  return Effect.gen(function* () {
    const stored = yield* input.state.listRemoteTasks({
      projectPath: input.snapshot.projectPath,
      sessionId: input.snapshot.sessionId,
      serverInstanceId: input.server.instanceId,
    })
    const selected = stored.filter(
      (task) => task.id === input.taskId || task.remoteTaskId === input.taskId,
    )
    const current = selected.filter(
      (task) =>
        task.configHash === input.server.configHash &&
        task.protocolVersion === input.connection.negotiatedProtocolVersion &&
        task.schemaHash === remoteTaskSchemaHash(input.connection),
    )
    if (selected.length > 0 && current.length === 0) {
      return yield* Effect.fail(
        new McpRuntimeError({
          operation: 'task-identity',
          message:
            'This MCP Task belongs to an earlier server configuration or protocol. Re-open the original configuration instead of sending its id to the current server.',
        }),
      )
    }
  })
}

function requestTaskOperation(
  connection: McpClientConnection,
  operation: McpTaskOperationInput['operation'],
  taskId: string | undefined,
) {
  if (operation === 'list') return fromConnection('listTasks', () => connection.listTasks())
  if (operation === 'get')
    return fromConnection('getTask', () => connection.getTask({ taskId: taskId ?? '' }))
  return fromConnection('cancelTask', () => connection.cancelTask({ taskId: taskId ?? '' }))
}

export function operateMcpTask(
  state: McpRuntimeStateService,
  snapshot: McpTurnSnapshot | null,
  input: McpTaskOperationInput,
): Effect.Effect<readonly McpTaskRecord[], McpRuntimeFailure> {
  return Effect.gen(function* () {
    if (!snapshot) return yield* operateStoredMcpTask(state, input)
    const { server, connection } = yield* state.getConnectionForServer(
      snapshot,
      input.serverInstanceId,
    )
    const taskId = input.taskId?.trim()
    if (input.operation !== 'list' && !taskId)
      return yield* Effect.fail(
        new McpRuntimeError({
          operation: input.operation,
          message: `${input.operation} requires taskId.`,
        }),
      )
    if (taskId) {
      yield* assertCurrentTaskIdentity({ state, snapshot, server, connection, taskId })
    }
    const result = yield* requestTaskOperation(connection, input.operation, taskId)
    const tasks = input.operation === 'list' ? values(result, 'tasks') : [result]
    return yield* state.recordRemoteTasks({ snapshot, server, connection, tasks })
  })
}
