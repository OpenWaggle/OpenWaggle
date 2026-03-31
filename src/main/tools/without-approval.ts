import type { DomainServerTool } from '../ports/tool-types'

/**
 * Return a new array of tools with `needsApproval` stripped to `false`.
 * Tools that don't have `needsApproval` are passed through by reference.
 * Accepts `readonly` input to document the no-mutation contract.
 */
export function withoutApproval(tools: readonly DomainServerTool[]): DomainServerTool[] {
  return tools.map((tool) => (tool.needsApproval ? { ...tool, needsApproval: false } : tool))
}
