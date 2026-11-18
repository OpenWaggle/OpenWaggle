import type { ToolDefinition } from '@earendil-works/pi-coding-agent'
import { fromPartial } from '@total-typescript/shoehorn'

/**
 * Every Hive rule a Session's grant gets: what `hive({ action: "help" })` returns. The system
 * prompt carries only the essential ones (`sessionsToolEssentialGuidelines`).
 */
export async function hiveHelpText(tool: ToolDefinition | undefined, topic?: string) {
  if (!tool) throw new Error('hive tool was not registered')
  const result = await tool.execute(
    'help-call',
    { action: 'help', ...(topic ? { topic } : {}) },
    undefined,
    undefined,
    fromPartial({}),
  )
  return result.content.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('\n')
}
