import { TaskId } from '@shared/types/brand'
import { z } from 'zod'
import { isBoardLoaded, loadTaskBoard, persistTaskBoard, updateTask } from '../../sub-agents/facade'
import { defineOpenWaggleTool } from '../define-tool'

export const taskUpdateTool = defineOpenWaggleTool({
  name: 'taskUpdate',
  description:
    'Update a task on the team task board. Use to mark tasks in_progress, completed, or deleted, assign owners, set dependencies, and modify details.',
  needsApproval: false,
  inputSchema: z.object({
    teamName: z.string().min(1).describe('Team that owns this task board'),
    taskId: z.string().min(1).describe('The ID of the task to update'),
    status: z
      .enum(['pending', 'in_progress', 'completed', 'deleted'])
      .optional()
      .describe('New status for the task'),
    subject: z.string().optional().describe('New task title'),
    description: z.string().optional().describe('New task description'),
    activeForm: z.string().optional().describe('Present continuous form for spinner'),
    owner: z.string().optional().describe('Agent name to assign as owner'),
    addBlocks: z.array(z.string()).optional().describe('Task IDs that this task blocks'),
    addBlockedBy: z.array(z.string()).optional().describe('Task IDs that block this task'),
    metadata: z
      .record(z.string(), z.unknown())
      .optional()
      .describe('Metadata keys to merge (set to null to delete)'),
  }),
  async execute(args, context) {
    if (!isBoardLoaded(args.teamName)) {
      await loadTaskBoard(context.projectPath, args.teamName)
    }

    const result = updateTask({
      teamId: args.teamName,
      taskId: TaskId(args.taskId),
      status: args.status,
      subject: args.subject,
      description: args.description,
      activeForm: args.activeForm,
      owner: args.owner,
      addBlocks: args.addBlocks?.map((id) => TaskId(id)),
      addBlockedBy: args.addBlockedBy?.map((id) => TaskId(id)),
      metadata: args.metadata,
    })

    if ('kind' in result) {
      if (result.kind === 'not_found') {
        return { kind: 'json', data: { ok: false, error: `Task "${args.taskId}" not found` } }
      }
      if (result.kind === 'invalid_transition') {
        return { kind: 'json', data: { ok: false, error: result.detail } }
      }
      return { kind: 'json', data: { ok: false, error: result.detail } }
    }

    await persistTaskBoard(context.projectPath, args.teamName)

    return {
      kind: 'json',
      data: {
        id: result.id,
        subject: result.subject,
        status: result.status,
        owner: result.owner,
        blocks: result.blocks,
        blockedBy: result.blockedBy,
        updatedAt: result.updatedAt,
      },
    }
  },
})
