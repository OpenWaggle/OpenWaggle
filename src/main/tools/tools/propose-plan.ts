import { BrowserWindow } from 'electron'
import { z } from 'zod'
import { sendAgentMessage } from '../../sub-agents/message-bus'
import { defineOpenWaggleTool } from '../define-tool'
import { waitForPlanResponse } from '../plan-manager'

export const proposePlanTool = defineOpenWaggleTool({
  name: 'proposePlan',
  description:
    'Present a plan to the user for approval before executing it. Use this when the task is complex enough to benefit from upfront planning, when the user explicitly requests a plan, or when the composer plan mode toggle is active. The plan should describe the approach, key steps, and expected changes. The tool blocks until the user approves or requests revisions. If the user revises, incorporate their feedback and call proposePlan again with the updated plan.',
  needsApproval: false,
  inputSchema: z.object({
    planText: z
      .string()
      .min(1)
      .describe('The plan text in markdown format describing the approach and steps'),
  }),
  async execute(args, context) {
    const { conversationId, signal, subAgentContext } = context

    // Sub-agents in a team route plan proposals to the team lead via message bus
    if (subAgentContext?.teamId) {
      sendAgentMessage({
        type: 'plan_approval_request',
        sender: subAgentContext.agentName,
        content: args.planText,
      })

      const response = await waitForPlanResponse(conversationId, signal)
      return JSON.stringify(response)
    }

    // Standard path: emit plan proposal to all renderer windows
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send('agent:plan-proposal', {
          conversationId,
          planText: args.planText,
        })
      }
    }

    // Block until the user responds or the run is aborted
    const response = await waitForPlanResponse(conversationId, signal)
    return JSON.stringify(response)
  },
})
