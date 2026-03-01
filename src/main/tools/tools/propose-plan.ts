import type { PlanResponse } from '@shared/types/plan'
import { BrowserWindow } from 'electron'
import { z } from 'zod'
import { defineOpenWaggleTool } from '../define-tool'
import { cancelPlanProposal, registerPlanProposal } from '../plan-manager'

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
    const { conversationId, signal } = context

    // Emit plan proposal event to all renderer windows
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send('agent:plan-proposal', {
          conversationId,
          planText: args.planText,
        })
      }
    }

    // Block until the user responds or the run is aborted
    const response = await new Promise<PlanResponse>((resolve, reject) => {
      registerPlanProposal(conversationId, resolve, reject)

      if (signal?.aborted) {
        cancelPlanProposal(conversationId)
        reject(new Error('Plan proposal cancelled'))
        return
      }

      signal?.addEventListener(
        'abort',
        () => {
          cancelPlanProposal(conversationId)
        },
        { once: true },
      )
    })

    return JSON.stringify(response)
  },
})
