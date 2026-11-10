/**
 * Project Pi extension: the end-of-turn agent gate. It records what each tool call changed and,
 * when the agent is about to stop, checks the files changed since the last passing gate. Blocking
 * findings go back to the agent as one message and the run continues once; if the next stop has
 * the same findings they go to the user and the run ends. Changes that need the user's approval
 * (an added dependency, a weakened tsconfig) are asked about right after the tool call.
 *
 * The logic lives in scripts/agent-gate; `bun scripts/agent-gate/check.ts` prints the same
 * verdict by hand. Set OPENWAGGLE_AGENT_GATE=off in the app's environment to turn it off.
 */
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent'
import { qualityGatesPlugin } from '../../scripts/agent-gate/quality-gates-plugin'
import { GATE_MESSAGE_TYPE } from '../../scripts/agent-gate/report'
import { AgentGateSession } from '../../scripts/agent-gate/session'

export default function agentGate(pi: ExtensionAPI) {
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

  pi.on('tool_call', async (event, ctx) => {
    context = ctx
    await session.beforeTool({
      id: event.toolCallId,
      ...(event.parentToolCallId === undefined ? {} : { parentId: event.parentToolCallId }),
      name: event.toolName,
      input: { ...event.input },
    })
  })

  pi.on('tool_result', async (event, ctx) => {
    context = ctx
    const note = await session.afterTool({
      id: event.toolCallId,
      ...(event.parentToolCallId === undefined ? {} : { parentId: event.parentToolCallId }),
      name: event.toolName,
      input: event.input,
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
    if (decision === undefined || decision.content === undefined) return undefined
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
}
