import { SubAgentId, SupportedModelId } from '@shared/types/brand'
import { z } from 'zod'
import { createLogger } from '../../logger'
import { getRunSubAgent } from '../../sub-agents/facade'
import { defineOpenWaggleTool } from '../define-tool'

const logger = createLogger('tool:spawnAgent')

export const spawnAgentTool = defineOpenWaggleTool({
  name: 'spawnAgent',
  description:
    'Launch a sub-agent to handle a task autonomously. Sub-agents can be specialized by type (explorer, planner, test-engineer, general-purpose, etc.), run in the background, work in isolated git worktrees, and collaborate via teams. Returns the agent result or an agent ID for background agents.',
  needsApproval: false,
  inputSchema: z.object({
    description: z
      .string()
      .min(1)
      .describe('Short (3-5 word) description of what the agent will do'),
    prompt: z.string().min(1).describe('Detailed task instructions for the sub-agent'),
    agentType: z
      .string()
      .optional()
      .describe(
        'Agent type: general-purpose (default), explorer, planner, test-engineer, ui-engineer, or a custom agent ID',
      ),
    name: z.string().optional().describe('Name for the agent (used in team communication)'),
    model: z.string().optional().describe('Model to use. Inherits from parent if not set.'),
    mode: z
      .enum(['default', 'acceptEdits', 'dontAsk', 'bypassPermissions', 'plan'])
      .optional()
      .describe('Permission mode for the agent'),
    isolation: z
      .enum(['worktree'])
      .optional()
      .describe('Set to "worktree" to run in an isolated git worktree'),
    runInBackground: z
      .boolean()
      .optional()
      .describe('Run the agent in the background. Returns immediately with an agent ID.'),
    teamName: z.string().optional().describe('Team to register the agent with'),
    resume: z.string().optional().describe('Agent ID to resume from a previous invocation'),
    maxTurns: z
      .number()
      .int()
      .positive()
      .optional()
      .describe('Maximum number of agent turns (default: 25)'),
  }),
  async execute(args, context) {
    // Lazy import: settings store creates electron-store at module level
    const { getSettings } = await import('../../store/settings')
    const runSubAgent = getRunSubAgent()
    const parentMode = context.subAgentContext?.permissionMode ?? 'default'

    const parentDepth = context.subAgentContext?.depth ?? 0

    const result = await runSubAgent({
      input: {
        description: args.description,
        prompt: args.prompt,
        agentType: args.agentType,
        name: args.name,
        model: args.model ? SupportedModelId(args.model) : undefined,
        mode: args.mode,
        isolation: args.isolation,
        runInBackground: args.runInBackground,
        teamName: args.teamName,
        resume: args.resume ? SubAgentId(args.resume) : undefined,
        maxTurns: args.maxTurns,
      },
      parentConversationId: context.conversationId,
      parentProjectPath: context.projectPath,
      parentModel: SupportedModelId(getSettings().defaultModel),
      parentPermissionMode: parentMode,
      parentDepth,
    })

    logger.info('spawnAgent completed', {
      agentId: result.agentId,
      status: result.status,
      turnCount: result.turnCount,
      toolCallCount: result.toolCallCount,
    })

    const parts = [
      `Agent ID: ${result.agentId}`,
      `Status: ${result.status}`,
      `Turns: ${String(result.turnCount)}`,
      `Tool calls: ${String(result.toolCallCount)}`,
    ]

    if (result.worktreeInfo) {
      parts.push(
        `Worktree: ${result.worktreeInfo.path}`,
        `Branch: ${result.worktreeInfo.branch}`,
        `Has changes: ${String(result.worktreeInfo.hasChanges)}`,
      )
    }

    parts.push('', 'Output:', result.output)

    return { kind: 'text', text: parts.join('\n') }
  },
})
