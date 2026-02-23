import { z } from 'zod'
import { getOrCreateSession } from '../../../browser'
import { defineOpenHiveTool } from '../../define-tool'

export const browserNavigateTool = defineOpenHiveTool({
  name: 'browserNavigate',
  description:
    'Navigate the browser to a URL. Launches a Chromium instance if none is running. Returns the page title, final URL, and HTTP status.',
  needsApproval: true,
  inputSchema: z.object({
    url: z.string().url().describe('The URL to navigate to'),
    waitUntil: z
      .enum(['load', 'domcontentloaded', 'networkidle'])
      .optional()
      .describe('When to consider navigation complete (default "load")'),
  }),
  async execute(args, context) {
    // Lazy import to avoid triggering electron-store initialization at module load time
    const { getSettings } = await import('../../../store/settings')
    const session = getOrCreateSession(context.conversationId)
    const settings = getSettings()
    await session.ensureBrowser(settings.browserHeadless)
    const result = await session.navigate(args.url, args.waitUntil)
    return { kind: 'json', data: result }
  },
})
