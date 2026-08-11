import { match } from '@diegogbrisa/ts-match'
import { z } from 'zod'
import type { OpenWaggleMcpServeOptions, OpenWaggleMcpServer } from './openwaggle-mcp-server-policy'
import {
  assertProjectAllowed,
  loadGrantedSession,
  requireGrant,
  toolResult,
} from './openwaggle-mcp-server-policy'
import type { OpenWaggleServerTaskManager } from './openwaggle-mcp-task-manager'

const MAX_OBJECTIVE_BYTES = 100_000

export function registerOpenWaggleTaskTool(
  server: OpenWaggleMcpServer,
  options: OpenWaggleMcpServeOptions,
  tasks: OpenWaggleServerTaskManager,
) {
  server.registerTool(
    'openwaggle_task',
    {
      title: 'OpenWaggle durable task',
      description:
        'Start, list, inspect, or cancel durable OpenWaggle agent work. Starting requires sessions:create for a new session or sessions:message for an existing session.',
      inputSchema: z.object({
        operation: z.enum(['start', 'list', 'get', 'cancel']),
        taskId: z.string().optional(),
        projectPath: z.string().optional(),
        sessionId: z.string().optional(),
        objective: z.string().optional(),
      }),
    },
    async (input) => executeTaskOperation(options, tasks, input),
  )
}

async function executeTaskOperation(
  options: OpenWaggleMcpServeOptions,
  tasks: OpenWaggleServerTaskManager,
  input: {
    operation: 'start' | 'list' | 'get' | 'cancel'
    taskId?: string
    projectPath?: string
    sessionId?: string
    objective?: string
  },
) {
  return match(input.operation)
    .with('list', async () => {
      requireGrant(options, 'sessions:discover')
      return toolResult(await tasks.list())
    })
    .with('get', async () => {
      requireGrant(options, 'sessions:read')
      return toolResult(await tasks.get(requireTaskId(input)))
    })
    .with('cancel', async () => {
      requireGrant(options, 'sessions:interrupt')
      return toolResult(await tasks.cancel(requireTaskId(input)))
    })
    .with('start', () => startTask(options, tasks, input))
    .exhaustive()
}

function requireTaskId(input: { readonly operation: string; readonly taskId?: string }) {
  if (!input.taskId) throw new Error(`${input.operation} requires taskId.`)
  return input.taskId
}

async function startTask(
  options: OpenWaggleMcpServeOptions,
  tasks: OpenWaggleServerTaskManager,
  input: {
    projectPath?: string
    sessionId?: string
    objective?: string
  },
) {
  if (!input.objective?.trim()) throw new Error('start requires objective.')
  if (Buffer.byteLength(input.objective, 'utf8') > MAX_OBJECTIVE_BYTES) {
    throw new Error(`Task objective exceeded ${String(MAX_OBJECTIVE_BYTES)} bytes.`)
  }
  if (input.sessionId) {
    requireGrant(options, 'sessions:message')
    const session = await loadGrantedSession(options, input.sessionId)
    if (!session.projectPath) throw new Error('The target session has no project path.')
    if (
      input.projectPath &&
      assertProjectAllowed(options, input.projectPath) !== session.projectPath
    ) {
      throw new Error('projectPath must match the target session project path.')
    }
    return toolResult(
      await tasks.start({
        projectPath: session.projectPath,
        objective: input.objective.trim(),
        sessionId: input.sessionId,
      }),
    )
  } else {
    requireGrant(options, 'sessions:create')
  }
  if (!input.projectPath?.trim()) throw new Error('Starting a new session requires projectPath.')
  return toolResult(
    await tasks.start({
      projectPath: assertProjectAllowed(options, input.projectPath),
      objective: input.objective.trim(),
      ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    }),
  )
}
