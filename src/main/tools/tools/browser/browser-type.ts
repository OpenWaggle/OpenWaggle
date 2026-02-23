import { z } from 'zod'
import { getOrCreateSession } from '../../../browser'
import { defineOpenHiveTool } from '../../define-tool'

export const browserTypeTool = defineOpenHiveTool({
  name: 'browserType',
  description:
    'Type text into an input field on the current page. Optionally press Enter after typing.',
  inputSchema: z.object({
    selector: z.string().describe('CSS selector of the input element'),
    text: z.string().describe('Text to type into the field'),
    pressEnter: z.boolean().optional().describe('Press Enter after typing (default false)'),
  }),
  async execute(args, context) {
    const session = getOrCreateSession(context.conversationId)
    await session.type(args.selector, args.text, args.pressEnter)
    const suffix = args.pressEnter ? ' and pressed Enter' : ''
    return `Typed into "${args.selector}"${suffix}`
  },
})
