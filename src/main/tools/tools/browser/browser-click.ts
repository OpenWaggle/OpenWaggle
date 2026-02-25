import { z } from 'zod'
import { getOrCreateSession } from '../../../browser'
import { defineOpenWaggleTool } from '../../define-tool'

export const browserClickTool = defineOpenWaggleTool({
  name: 'browserClick',
  description:
    'Click an element on the current page using a CSS selector. The browser must already be navigated to a page.',
  inputSchema: z.object({
    selector: z.string().describe('CSS selector of the element to click'),
  }),
  async execute(args, context) {
    const session = getOrCreateSession(context.conversationId)
    await session.click(args.selector)
    return `Clicked element matching "${args.selector}"`
  },
})
