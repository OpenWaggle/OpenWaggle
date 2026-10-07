import { Network } from 'lucide-react'

/**
 * Placeholder while MCP moves onto Pi's built-in MCP runtime (ADR 0048). The previous Settings >
 * MCP panels drove OpenWaggle's own MCP client, which is gone; the new panels are rebuilt over
 * the Host's MCP configuration operations.
 */
export function McpSection() {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Network className="size-5 text-accent" />
        <h2 className="text-xl font-semibold text-text-primary">MCP</h2>
      </div>
      <p className="max-w-190 text-xs leading-5 text-text-tertiary">
        MCP servers are moving to a new runtime. Server settings return here in a later build; until
        then, sessions do not use MCP tools.
      </p>
    </div>
  )
}
