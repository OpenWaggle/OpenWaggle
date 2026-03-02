import { z } from 'zod'
import { cleanupTeamConfig, deleteTeam } from '../../sub-agents/facade'
import { defineOpenWaggleTool } from '../define-tool'

export const teamDeleteTool = defineOpenWaggleTool({
  name: 'teamDelete',
  description:
    'Delete a team and its associated task board. All team members must be shut down first.',
  needsApproval: false,
  inputSchema: z.object({
    teamName: z.string().min(1).describe('Name of the team to delete'),
  }),
  async execute(args, context) {
    deleteTeam(args.teamName)
    await cleanupTeamConfig(context.projectPath, args.teamName)

    return { kind: 'json', data: { deleted: true, teamName: args.teamName } }
  },
})
