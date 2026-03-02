import { z } from 'zod'
import { createTeam, persistTeamConfig } from '../../sub-agents/facade'
import { defineOpenWaggleTool } from '../define-tool'

export const teamCreateTool = defineOpenWaggleTool({
  name: 'teamCreate',
  description:
    'Create a new team for coordinating multiple sub-agents. Teams provide a shared task board and inter-agent messaging. Create a team before spawning agents with teamName.',
  needsApproval: false,
  inputSchema: z.object({
    teamName: z.string().min(1).describe('Name for the new team'),
    description: z.string().optional().describe('Team description/purpose'),
  }),
  async execute(args, context) {
    const team = createTeam(args.teamName, args.description)
    await persistTeamConfig(context.projectPath, args.teamName)

    return {
      kind: 'json',
      data: {
        id: team.id,
        name: team.name,
        description: team.description,
        members: [],
        createdAt: team.createdAt,
      },
    }
  },
})
