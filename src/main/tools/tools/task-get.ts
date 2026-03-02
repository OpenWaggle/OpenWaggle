import { TaskId } from '@shared/types/brand'
import { z } from 'zod'
import { getTask, isBoardLoaded, loadTaskBoard } from '../../sub-agents/facade'
import { defineOpenWaggleTool } from '../define-tool'

export const taskGetTool = defineOpenWaggleTool({
  name: 'taskGet',
  description:
    'Get full details of a specific task including description, dependencies, and metadata.',
  needsApproval: false,
  inputSchema: z.object({
    teamName: z.string().min(1).describe('Team that owns this task board'),
    taskId: z.string().min(1).describe('The ID of the task to retrieve'),
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
