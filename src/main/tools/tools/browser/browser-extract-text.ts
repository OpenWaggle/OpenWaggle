import { z } from 'zod'
import { getOrCreateSession } from '../../../browser'
import { defineOpenHiveTool } from '../../define-tool'

export const browserExtractTextTool = defineOpenHiveTool({
  name: 'browserExtractText',
  description:
    'Extract visible text from the current page or a specific element. Useful for reading page content without a screenshot.',
  inputSchema: z.object({
    selector: z
      .string()
      .optional()
      .describe('CSS selector to scope text extraction (default: entire page body)'),
  }),
  async execute(args, context) {
    const session = getOrCreateSession(context.conversationId)
    return session.extractText(args.selector)
  },
})
