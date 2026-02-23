import { z } from 'zod'
import { getOrCreateSession } from '../../../browser'
import { defineOpenHiveTool } from '../../define-tool'

export const browserFillFormTool = defineOpenHiveTool({
  name: 'browserFillForm',
  description:
    'Fill multiple form fields at once. Each field is identified by a CSS selector and filled with the given value.',
  inputSchema: z.object({
    fields: z
      .array(
        z.object({
          selector: z.string().describe('CSS selector of the input field'),
          value: z.string().describe('Value to fill into the field'),
        }),
      )
      .min(1)
      .describe('Array of fields to fill'),
  }),
  async execute(args, context) {
    const session = getOrCreateSession(context.conversationId)
    const filled = await session.fillForm(args.fields)
    return `Filled ${filled.length} field(s): ${filled.join(', ')}`
  },
})
