import { z } from 'zod'
import { getOrCreateSession } from '../../../browser'
import type { NormalizedToolResult } from '../../define-tool'
import { defineOpenWaggleTool } from '../../define-tool'

export const browserScreenshotTool = defineOpenWaggleTool({
  name: 'browserScreenshot',
  description:
    'Take a screenshot of the current page or a specific element. Returns a base64-encoded PNG image.',
  inputSchema: z.object({
    fullPage: z.boolean().optional().describe('Capture the full scrollable page (default false)'),
    selector: z.string().optional().describe('CSS selector to screenshot a specific element'),
  }),
  async execute(args, context): Promise<NormalizedToolResult> {
    const session = getOrCreateSession(context.conversationId)
    const result = await session.screenshot(args.fullPage, args.selector)
    return { kind: 'json', data: result }
  },
})
