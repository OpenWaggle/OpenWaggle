import { Schema } from '@shared/schema'
import { cleanupTeamConfig, deleteTeam } from '../../sub-agents/facade'
import { defineOpenWaggleTool } from '../define-tool'

export const teamDeleteTool = defineOpenWaggleTool({
  name: 'teamDelete',
  description:
    'Delete a team and its associated task board. All team members must be shut down first.',
  needsApproval: false,
  inputSchema: Schema.Struct({
    teamName: Schema.String.pipe(
      Schema.minLength(1),
      Schema.annotations({ description: 'Name of the team to delete' }),
    ),
  }),
  async execute(args, context) {
    deleteTeam(args.teamName)
    await cleanupTeamConfig(context.projectPath, args.teamName)

    return { kind: 'json', data: { deleted: true, teamName: args.teamName } }
  },
})
