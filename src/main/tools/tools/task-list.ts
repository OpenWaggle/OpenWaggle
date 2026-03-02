import { z } from 'zod'
import { isBoardLoaded, listTasks, loadTaskBoard } from '../../sub-agents/facade'
import { defineOpenWaggleTool } from '../define-tool'

export const taskListTool = defineOpenWaggleTool({
  name: 'taskList',
  description:
    'List all tasks on the team task board. Shows task summary including ID, subject, status, owner, and blocked-by dependencies. Use taskGet for full task details.',
  needsApproval: false,
  inputSchema: z.object({
    teamName: z.string().min(1).describe('Team that owns this task board'),
  }),
  async execute(args, context) {
    if (!isBoardLoaded(args.teamName)) {
      await loadTaskBoard(context.projectPath, args.teamName)
    }

    const tasks = listTasks(args.teamName)

    const summary = tasks
      .filter((t) => t.status !== 'deleted')
      .map((t) => ({
        id: t.id,
        subject: t.subject,
        status: t.status,
        owner: t.owner ?? '',
        blockedBy: t.blockedBy.filter((depId) => {
          // Only show open (non-completed) blockers
          const dep = tasks.find((tt) => tt.id === depId)
          return dep && dep.status !== 'completed'
        }),
      }))

    return { kind: 'json', data: { tasks: summary } }
  },
})
