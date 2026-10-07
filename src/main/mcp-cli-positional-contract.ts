import type { ParsedArguments } from './mcp-cli-arguments'

const COMMAND_ARGUMENTS: Readonly<
  Record<
    string,
    { readonly minimum: number; readonly maximum: number; readonly allowPassthrough?: boolean }
  >
> = {
  help: { minimum: 0, maximum: 0 },
  serve: { minimum: 0, maximum: 0 },
}

export function validateMcpCliPositionals(command: string, arguments_: ParsedArguments) {
  const contract = COMMAND_ARGUMENTS[command]
  if (!contract) throw new Error(`Unsupported MCP command: ${command}.`)
  if (!contract.allowPassthrough && arguments_.passthrough.length > 0) {
    throw new Error(`MCP ${command} does not accept arguments after --.`)
  }
  if (arguments_.positionals.length < contract.minimum) {
    throw new Error(`MCP ${command} requires more positional arguments.`)
  }
  if (arguments_.positionals.length > contract.maximum) {
    throw new Error(`MCP ${command} received unexpected positional arguments.`)
  }
}
