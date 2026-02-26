import type { ServerTool } from '@tanstack/ai'

/**
 * Return a new array of tools with `needsApproval` stripped to `false`.
 * Tools that don't have `needsApproval` are passed through by reference.
 * Accepts `readonly` input to document the no-mutation contract.
 */
export function withoutApproval(tools: readonly ServerTool[]): ServerTool[] {
  return tools.map((tool) => (tool.needsApproval ? { ...tool, needsApproval: false } : tool))
}
