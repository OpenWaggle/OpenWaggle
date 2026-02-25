import { z } from 'zod'
import { getOrCreateSession } from '../../../browser'
import { defineOpenWaggleTool } from '../../define-tool'

export const browserExtractTextTool = defineOpenWaggleTool({
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
