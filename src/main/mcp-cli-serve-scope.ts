import type { ParsedArguments } from './mcp-cli-arguments'

export function requireServeScope(arguments_: ParsedArguments) {
  const workspaces = arguments_.options.get('workspace') ?? []
  const sessions = arguments_.options.get('session') ?? []
  if (workspaces.length === 0 && sessions.length === 0) {
    throw new Error(
      'Server mode requires at least one explicit --workspace <path> or --session <id> scope. Use --workspace / only when intentionally granting every project.',
    )
  }
  return { workspaces, sessions }
}
