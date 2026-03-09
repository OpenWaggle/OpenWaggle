import { Schema } from '@shared/schema'
import { TaskId } from '@shared/types/brand'
import { getTask, isBoardLoaded, loadTaskBoard } from '../../sub-agents/facade'
import { defineOpenWaggleTool } from '../define-tool'

export const taskGetTool = defineOpenWaggleTool({
  name: 'taskGet',
  description:
    'Get full details of a specific task including description, dependencies, and metadata.',
  needsApproval: false,
  inputSchema: Schema.Struct({
    teamName: Schema.String.pipe(
      Schema.minLength(1),
      Schema.annotations({ description: 'Team that owns this task board' }),
    ),
    taskId: Schema.String.pipe(
      Schema.minLength(1),
      Schema.annotations({ description: 'The ID of the task to retrieve' }),
    ),
  }),
  async execute(args, context) {
    if (!isBoardLoaded(args.teamName)) {
      await loadTaskBoard(context.projectPath, args.teamName)
    }

    const task = getTask(args.teamName, TaskId(args.taskId))
    if (!task) {
      return { kind: 'json', data: { ok: false, error: `Task "${args.taskId}" not found` } }
    }

    return {
      kind: 'json',
      data: {
        id: task.id,
        subject: task.subject,
        description: task.description,
        activeForm: task.activeForm,
        status: task.status,
        owner: task.owner,
        blocks: task.blocks,
        blockedBy: task.blockedBy,
        metadata: task.metadata,
        createdAt: task.createdAt,
        updatedAt: task.updatedAt,
      },
    }
  },
})
