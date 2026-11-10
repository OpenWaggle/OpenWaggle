/**
 * Project Pi extension: the end-of-turn agent gate. It records what each tool call changed and,
 * when the agent is about to stop, checks the files changed since the last passing gate: format,
 * lint, the affected projects' type check, new suppressions, dependency pins, weakened tsconfigs,
 * generated files, test runs, watched docs, and Fallow and React Doctor. Blocking findings go back
 * to the agent as one message and the run continues; if the next stop has the same findings, or
 * the run already had MAX_FEEDBACK_ROUNDS continuations, they go to the user and the run ends.
 * Changes that need the user's approval (an added dependency, a weakened tsconfig) are asked about
 * right after the tool call that made them.
 *
 * `agent_before_settle` is Pi's last actionable boundary of a run: it fires once the agent has
 * stopped calling tools, may append entries, and may ask for one more model request. The logic
 * lives in scripts/agent-gate and scripts/agent-quality-gates; `bun scripts/agent-gate/check.ts`
 * prints the same verdict by hand. OPENWAGGLE_AGENT_GATE=off in the app's environment turns it off.
 */
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent'
import { qualityGatesPlugin } from '../../scripts/agent-gate/quality-gates-plugin'
import { GATE_MESSAGE_TYPE } from '../../scripts/agent-gate/report'
import { AgentGateSession, type ToolCall } from '../../scripts/agent-gate/session'

function toolCall(event: {
  readonly toolCallId: string
  readonly parentToolCallId?: string
  readonly toolName: string
  readonly input: Readonly<Record<string, unknown>>
}): ToolCall {
  return {
    id: event.toolCallId,
    ...(event.parentToolCallId === undefined ? {} : { parentId: event.parentToolCallId }),
    name: event.toolName,
    input: { ...event.input },
  }
}

export default function qualityGates(pi: ExtensionAPI) {
  if (process.env['OPENWAGGLE_AGENT_GATE'] === 'off') return
  let context: ExtensionContext | undefined = undefined
  const session = new AgentGateSession({
    plugins: [qualityGatesPlugin],
    ask: (title, message) =>
      context?.hasUI === true ? context.ui.confirm(title, message) : Promise.resolve(undefined),
  })

  pi.on('session_start', async (_event, ctx) => {
    context = ctx
    await session.start(ctx.cwd)
  })

  pi.on('before_agent_start', (event) => {
    if (event.messageType === 'user') session.notePrompt(event.prompt)
  })

  // Awaited, so the snapshot is taken before the tool runs.
  pi.on('tool_call', async (event, ctx) => {
    context = ctx
    await session.beforeTool(toolCall(event))
  })

  pi.on('tool_result', async (event, ctx) => {
    context = ctx
    const note = await session.afterTool({
      ...toolCall(event),
      isError: event.isError,
      structuredContent: event.structuredContent,
    })
    if (note === undefined) return undefined
    return {
      content: [...event.content, { type: 'text' as const, text: note }],
      ...(event.structuredContent === undefined
        ? {}
        : { structuredContent: event.structuredContent }),
    }
  })

  pi.on('agent_before_settle', async (event, ctx) => {
    context = ctx
    const decision = await session.settle(
      { outcome: event.outcome, canContinue: event.context.canContinue },
      ctx.signal,
    )
    if (decision?.content === undefined) return undefined
    return {
      entries: [
        ...event.entries,
        {
          type: 'custom_message' as const,
          customType: GATE_MESSAGE_TYPE,
          content: decision.content,
          display: true,
        },
      ],
      ...(decision.kind === 'block' ? { continue: true } : {}),
    }
  })

  pi.on('agent_settled', () => {
    session.settled()
  })
}
