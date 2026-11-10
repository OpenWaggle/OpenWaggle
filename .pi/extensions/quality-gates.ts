/**
 * Project Pi extension: before an agent run settles, runs Fallow and React Doctor on the files
 * the run changed and, when they report findings, adds them as a follow-up message and continues
 * the run so the agent fixes them before it finishes. Silent when the changed files are clean.
 * The logic lives in `scripts/agent-quality-gates`.
 *
 * `agent_before_settle` is Pi's last actionable boundary of a run: it fires once the agent has
 * stopped calling tools, may append entries, and may ask for one more model request.
 */
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import {
  QUALITY_GATES_MESSAGE_TYPE,
  QualityGateSession,
} from '../../scripts/agent-quality-gates/session'

export default function qualityGates(pi: ExtensionAPI) {
  const session = new QualityGateSession()

  // Awaited, so the snapshot is taken before the run's first tool call.
  pi.on('agent_start', async (_event, ctx) => {
    await session.start(ctx.cwd)
  })

  pi.on('agent_before_settle', async (event, ctx) => {
    const feedback = await session.beforeSettle(
      { outcome: event.outcome, canContinue: event.context.canContinue },
      ctx.signal,
    )
    if (feedback === undefined) {
      return undefined
    }
    return {
      entries: [
        ...event.entries,
        {
          type: 'custom_message',
          customType: QUALITY_GATES_MESSAGE_TYPE,
          content: feedback.content,
          display: true,
        },
      ],
      continue: true,
    }
  })

  pi.on('agent_settled', () => {
    session.settled()
  })
}
