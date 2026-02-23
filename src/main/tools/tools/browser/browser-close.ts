import { z } from 'zod'
import { closeSession } from '../../../browser'
import { defineOpenHiveTool } from '../../define-tool'

export const browserCloseTool = defineOpenHiveTool({
  name: 'browserClose',
  description: 'Close the browser instance for the current conversation, freeing resources.',
  inputSchema: z.object({}),
  async execute(_args, context) {
    await closeSession(context.conversationId)
    return 'Browser closed.'
  },
})
