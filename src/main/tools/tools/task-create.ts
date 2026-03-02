import { z } from 'zod'
import { createTask, isBoardLoaded, loadTaskBoard, persistTaskBoard } from '../../sub-agents/facade'
import { defineOpenWaggleTool } from '../define-tool'

export const taskCreateTool = defineOpenWaggleTool({
  name: 'taskCreate',
  description:
    'Create a task on the team task board. Tasks help coordinate work between agents. New tasks start with status "pending".',
  needsApproval: false,
  inputSchema: z.object({
    teamName: z.string().min(1).describe('Team that owns this task board'),
    subject: z.string().min(1).describe('Brief title for the task (imperative form)'),
    description: z.string().min(1).describe('Detailed description of what needs to be done'),
    activeForm: z
      .string()
      .optional()
      .describe('Present continuous form shown when in_progress (e.g., "Running tests")'),
    metadata: z.record(z.string(), z.unknown()).optional().describe('Arbitrary metadata to attach'),
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
