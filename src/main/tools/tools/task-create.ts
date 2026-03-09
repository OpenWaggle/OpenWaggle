import { Schema } from '@shared/schema'
import { createTask, isBoardLoaded, loadTaskBoard, persistTaskBoard } from '../../sub-agents/facade'
import { defineOpenWaggleTool } from '../define-tool'

export const taskCreateTool = defineOpenWaggleTool({
  name: 'taskCreate',
  description:
    'Create a task on the team task board. Tasks help coordinate work between agents. New tasks start with status "pending".',
  needsApproval: false,
  inputSchema: Schema.Struct({
    teamName: Schema.String.pipe(
      Schema.minLength(1),
      Schema.annotations({ description: 'Team that owns this task board' }),
    ),
    subject: Schema.String.pipe(
      Schema.minLength(1),
      Schema.annotations({ description: 'Brief title for the task (imperative form)' }),
    ),
    description: Schema.String.pipe(
      Schema.minLength(1),
      Schema.annotations({ description: 'Detailed description of what needs to be done' }),
    ),
    activeForm: Schema.optional(
      Schema.String.annotations({
        description: 'Present continuous form shown when in_progress (e.g., "Running tests")',
      }),
    ),
    metadata: Schema.optional(
      Schema.Record({ key: Schema.String, value: Schema.Unknown }).annotations({
        description: 'Arbitrary metadata to attach',
      }),
    ),
  }),
  async execute(args, context) {
    if (!isBoardLoaded(args.teamName)) {
      await loadTaskBoard(context.projectPath, args.teamName)
    }

    const task = createTask({
      teamId: args.teamName,
      subject: args.subject,
      description: args.description,
      activeForm: args.activeForm,
      metadata: args.metadata,
    })

    await persistTaskBoard(context.projectPath, args.teamName)

    return {
      kind: 'json',
      data: {
        id: task.id,
        subject: task.subject,
        status: task.status,
        createdAt: task.createdAt,
      },
    }
  },
})
