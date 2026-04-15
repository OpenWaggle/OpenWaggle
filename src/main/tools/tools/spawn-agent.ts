import { Schema } from '@shared/schema'
import { SubAgentId, SupportedModelId } from '@shared/types/brand'
import { createLogger } from '../../logger'
import { getRunSubAgent } from '../../sub-agents/facade'
import { defineOpenWaggleTool } from '../define-tool'

const logger = createLogger('tool:spawnAgent')

export const spawnAgentTool = defineOpenWaggleTool({
  name: 'spawnAgent',
  description:
    'Launch a sub-agent to handle a task autonomously. Sub-agents can be specialized by type (explorer, planner, test-engineer, general-purpose, etc.), run in the background, work in isolated git worktrees, and collaborate via teams. Returns the agent result or an agent ID for background agents.',
  needsApproval: false,
  inputSchema: Schema.Struct({
    description: Schema.String.pipe(
      Schema.minLength(1),
      Schema.annotations({ description: 'Short (3-5 word) description of what the agent will do' }),
    ),
    prompt: Schema.String.pipe(
      Schema.minLength(1),
      Schema.annotations({ description: 'Detailed task instructions for the sub-agent' }),
    ),
    agentType: Schema.optional(
      Schema.NullOr(
        Schema.String.annotations({
          description:
            'Agent type: general-purpose (default), explorer, planner, test-engineer, ui-engineer, or a custom agent ID',
        }),
      ),
    ),
    name: Schema.optional(
      Schema.NullOr(
        Schema.String.annotations({
          description: 'Name for the agent (used in team communication)',
        }),
      ),
    ),
    model: Schema.optional(
      Schema.NullOr(
        Schema.String.annotations({
          description: 'Model to use. Inherits from parent if not set.',
        }),
      ),
    ),
    mode: Schema.optional(
      Schema.NullOr(
        Schema.Literal(
          'default',
          'acceptEdits',
          'dontAsk',
          'bypassPermissions',
          'plan',
        ).annotations({
          description: 'Permission mode for the agent',
        }),
      ),
    ),
    isolation: Schema.optional(
      Schema.NullOr(
        Schema.Literal('worktree').annotations({
          description: 'Set to "worktree" to run in an isolated git worktree',
        }),
      ),
    ),
    runInBackground: Schema.optional(
      Schema.NullOr(
        Schema.Boolean.annotations({
          description: 'Run the agent in the background. Returns immediately with an agent ID.',
        }),
      ),
    ),
    teamName: Schema.optional(
      Schema.NullOr(Schema.String.annotations({ description: 'Team to register the agent with' })),
    ),
    resume: Schema.optional(
      Schema.NullOr(
        Schema.String.annotations({ description: 'Agent ID to resume from a previous invocation' }),
      ),
    ),
    maxTurns: Schema.optional(
      Schema.NullOr(
        Schema.Number.pipe(
          Schema.int(),
          Schema.positive(),
          Schema.annotations({ description: 'Maximum number of agent turns (default: 25)' }),
        ),
      ),
    ),
  }),
  async execute(args, context) {
    // Lazy import keeps startup wiring light and avoids unnecessary module cycles.
    const { getSettings } = await import('../../store/settings')
    const runSubAgent = getRunSubAgent()
    const parentMode = context.subAgentContext?.permissionMode ?? 'default'

    const parentDepth = context.subAgentContext?.depth ?? 0

    const result = await runSubAgent({
      input: {
        description: args.description,
        prompt: args.prompt,
        agentType: args.agentType ?? undefined,
        name: args.name ?? undefined,
        model: args.model ? SupportedModelId(args.model) : undefined,
        mode: args.mode ?? undefined,
        isolation: args.isolation ?? undefined,
        runInBackground: args.runInBackground ?? undefined,
        teamName: args.teamName ?? undefined,
        resume: args.resume ? SubAgentId(args.resume) : undefined,
        maxTurns: args.maxTurns ?? undefined,
      },
      parentConversationId: context.conversationId,
      parentProjectPath: context.projectPath,
      parentModel: SupportedModelId(getSettings().selectedModel),
      parentPermissionMode: parentMode,
      parentDepth,
      // context.chatStream is always set by agent-loop (toolContext.chatStream = params.chatStream).
      // The fallback exists only because ToolContext.chatStream is typed as optional to avoid
      // requiring it in file-tool tests that never spawn sub-agents.
      chatStream:
        context.chatStream ??
        (() => {
          throw new Error('chatStream not available in tool context')
        }),
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
