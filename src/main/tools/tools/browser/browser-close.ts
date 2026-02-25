import { z } from 'zod'
import { closeSession } from '../../../browser'
import { defineOpenWaggleTool } from '../../define-tool'

export const browserCloseTool = defineOpenWaggleTool({
  name: 'browserClose',
  description: 'Close the browser instance for the current conversation, freeing resources.',
  inputSchema: z.object({}),
  async execute(_args, context) {
    await closeSession(context.conversationId)
    return 'Browser closed.'
  },
})
