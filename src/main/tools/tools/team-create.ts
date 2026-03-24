import { Schema } from '@shared/schema'
import { createTeam, persistTeamConfig } from '../../sub-agents/facade'
import { defineOpenWaggleTool } from '../define-tool'

export const teamCreateTool = defineOpenWaggleTool({
  name: 'teamCreate',
  description:
    'Create a new team for coordinating multiple sub-agents. Teams provide a shared task board and inter-agent messaging. Create a team before spawning agents with teamName.',
  needsApproval: false,
  inputSchema: Schema.Struct({
    teamName: Schema.String.pipe(
      Schema.minLength(1),
      Schema.annotations({ description: 'Name for the new team' }),
    ),
    description: Schema.optional(
      Schema.NullOr(Schema.String.annotations({ description: 'Team description/purpose' })),
    ),
  }),
  async execute(args, context) {
    const team = createTeam(args.teamName, args.description ?? undefined)
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
