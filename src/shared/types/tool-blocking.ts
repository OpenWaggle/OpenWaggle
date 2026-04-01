import type { UserBlockingToolName } from '../../main/tools/built-in-tools'

export type { UserBlockingToolName }

/**
 * Runtime list of tool names that block indefinitely waiting for user input.
 * Used for checkpoint triggers (main) and collapse prevention (renderer).
 *
 * Must match the tools in `userBlockingTools` from `built-in-tools.ts`.
 * Adding a wrong tool name here is a compile error because the type is
 * derived from the tool definitions.
 */
export const USER_BLOCKING_TOOL_NAMES: readonly UserBlockingToolName[] = ['proposePlan', 'askUser']

export function isUserBlockingToolName(name: string): name is UserBlockingToolName {
  for (const toolName of USER_BLOCKING_TOOL_NAMES) {
    if (toolName === name) {
      return true
    }
  }
  return false
}
