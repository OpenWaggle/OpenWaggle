import { Schema } from '@shared/schema'
import { TaskId } from '@shared/types/brand'
import { isBoardLoaded, loadTaskBoard, persistTaskBoard, updateTask } from '../../sub-agents/facade'
import { defineOpenWaggleTool } from '../define-tool'

export const taskUpdateTool = defineOpenWaggleTool({
  name: 'taskUpdate',
  description:
    'Update a task on the team task board. Use to mark tasks in_progress, completed, or deleted, assign owners, set dependencies, and modify details.',
  needsApproval: false,
  inputSchema: Schema.Struct({
    teamName: Schema.String.pipe(
      Schema.minLength(1),
      Schema.annotations({ description: 'Team that owns this task board' }),
    ),
    taskId: Schema.String.pipe(
      Schema.minLength(1),
      Schema.annotations({ description: 'The ID of the task to update' }),
    ),
    status: Schema.optional(
      Schema.Literal('pending', 'in_progress', 'completed', 'deleted').annotations({
        description: 'New status for the task',
      }),
    ),
    subject: Schema.optional(Schema.String.annotations({ description: 'New task title' })),
    description: Schema.optional(
      Schema.String.annotations({ description: 'New task description' }),
    ),
    activeForm: Schema.optional(
      Schema.String.annotations({ description: 'Present continuous form for spinner' }),
    ),
    owner: Schema.optional(
      Schema.String.annotations({ description: 'Agent name to assign as owner' }),
    ),
    addBlocks: Schema.optional(
      Schema.Array(Schema.String).annotations({
        description: 'Task IDs that this task blocks',
      }),
    ),
    addBlockedBy: Schema.optional(
      Schema.Array(Schema.String).annotations({
        description: 'Task IDs that block this task',
      }),
    ),
    metadata: Schema.optional(
      Schema.Record({ key: Schema.String, value: Schema.Unknown }).annotations({
        description: 'Metadata keys to merge (set to null to delete)',
      }),
    ),
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
