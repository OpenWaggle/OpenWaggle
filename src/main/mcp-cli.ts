import path from 'node:path'
import { app } from 'electron'
import {
  formatMcpCliOutput,
  hasFlag,
  option,
  type ParsedArguments,
  parseMcpCliArguments,
  readSecretFromStdin,
  requireServeScope,
  validateMcpCliOptions,
} from './mcp-cli-arguments'
import { runMcpManagementCommand } from './mcp-cli-management'
import {
  OPENWAGGLE_MCP_SERVE_GRANTS,
  type OpenWaggleMcpServeGrant,
  serveOpenWaggleMcpServer,
} from './openwaggle-mcp-server'

const EXIT = { SUCCESS: 0, FAILURE: 1, USAGE: 2, NOT_FOUND: 3, POLICY: 4 } as const

function usage() {
  return `OpenWaggle MCP

Usage:
  openwaggle mcp add <name> --url <https-url> [--scope global|project]
  openwaggle mcp add <name> [options] -- <command> [args...]
  openwaggle mcp list|get|enable|disable|trust|remove <name> [options]
  openwaggle mcp auth <name> [--secret <name>] [--secret-stdin]
  openwaggle mcp logout <name>
  openwaggle mcp import [--from codex,claude-code,opencode,pi,vscode] [--apply]
  openwaggle mcp registry search|get|add <query-or-name> [--package npm|pypi|nuget|oci|mcpb]
  openwaggle mcp doctor
  openwaggle mcp serve --stdio [--profile <name>] [--grant <capability>]...
                       [--workspace <path>]... [--session <id>]...
                       [--origin-session <id>]
  openwaggle mcp serve --http <port> --token-stdin [--profile <name>]
                       [--grant <capability>]... [--workspace <path>]...
                       [--session <id>]... [--origin-session <id>]

Server scope: at least one --workspace <path> or --session <id> is required.
Common options: --project <path>, --scope global|project, --json`
}

function parseServeGrants(values: readonly string[] | undefined) {
  const grants = new Set<OpenWaggleMcpServeGrant>()
  for (const value of (values ?? []).flatMap((entry) => entry.split(','))) {
    const grant = value.trim()
    const supportedGrant = OPENWAGGLE_MCP_SERVE_GRANTS.find((candidate) => candidate === grant)
    if (!supportedGrant) {
      throw new Error(
        `Unsupported server grant ${JSON.stringify(grant)}. Supported grants: ${OPENWAGGLE_MCP_SERVE_GRANTS.join(', ')}.`,
      )
    }
    grants.add(supportedGrant)
  }
  return grants
}

function parseServeTransport(arguments_: ParsedArguments) {
  const stdio = hasFlag(arguments_, 'stdio')
  const http = option(arguments_, 'http')
  if (stdio === Boolean(http)) {
    throw new Error('Server mode requires exactly one explicit --stdio or --http <port>.')
  }
  if (http && !hasFlag(arguments_, 'token-stdin')) {
    throw new Error('Loopback Streamable HTTP requires --token-stdin.')
  }
  return { stdio, http, httpPort: http === undefined ? undefined : Number(http) }
}

function parseServeIdentity(arguments_: ParsedArguments, stdio: boolean) {
  const profile = option(arguments_, 'profile')?.trim() || (stdio ? 'local-stdio' : 'local-http')
  if (!/^[A-Za-z0-9._-]{1,80}$/.test(profile)) {
    throw new Error('Server profile must use 1-80 letters, numbers, dots, underscores, or dashes.')
  }
  const originSessionId = option(arguments_, 'origin-session')?.trim()
  if (originSessionId && !/^[A-Za-z0-9._:-]{1,200}$/.test(originSessionId)) {
    throw new Error(
      'Origin session must use 1-200 letters, numbers, dots, underscores, colons, or dashes.',
    )
  }
  return { profile, originSessionId }
}

async function runServeCommand(arguments_: ParsedArguments) {
  const { stdio, http, httpPort } = parseServeTransport(arguments_)
  const { profile, originSessionId } = parseServeIdentity(arguments_, stdio)
  const scope = requireServeScope(arguments_)
  await serveOpenWaggleMcpServer({
    transport: stdio ? 'stdio' : 'streamable-http',
    ...(httpPort === undefined ? {} : { httpPort }),
    ...(http ? { bearerToken: await readSecretFromStdin() } : {}),
    grants: parseServeGrants(arguments_.options.get('grant')),
    workspaceRoots: scope.workspaces.map((entry) => path.resolve(entry)),
    sessionIds: new Set(scope.sessions),
    ...(originSessionId ? { originSessionId } : {}),
    profile,
    taskStorePath: path.join(app.getPath('userData'), 'mcp-server-tasks.json'),
    version: app.getVersion(),
    stderr: process.stderr,
  })
}

function writeOutput(value: unknown, json: boolean) {
  process.stdout.write(`${formatMcpCliOutput(value, json)}\n`)
}

function writeError(error: unknown, json: boolean) {
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(
    `${json ? JSON.stringify({ schemaVersion: 1, error: { message } }) : `error: ${message}`}\n`,
  )
}

function exitCodeForError(message: string) {
  if (message.includes('was not found')) return EXIT.NOT_FOUND
  const usagePrefixes = [
    'Usage:',
    'Unknown option',
    'Unsupported MCP scope',
    'Unsupported MCP transport',
    'Unsupported MCP compatibility',
  ]
  if (usagePrefixes.some((prefix) => message.startsWith(prefix))) return EXIT.USAGE
  if (message.includes('requires a server name')) return EXIT.USAGE
  if (message.includes('Cannot trust') || message.includes('require')) return EXIT.POLICY
  return EXIT.FAILURE
}

export function getMcpCliArguments(argv: readonly string[]) {
  const marker = argv.indexOf('mcp')
  return marker < 0 ? null : argv.slice(marker + 1)
}

export async function runMcpCli(args: readonly string[]) {
  const parsed = parseMcpCliArguments(args)
  const command = parsed.positionals[0]
  const commandArguments = { ...parsed, positionals: parsed.positionals.slice(1) }
  const json = hasFlag(parsed, 'json')
  try {
    validateMcpCliOptions(command ?? 'help', commandArguments)
    if (!command || command === 'help') {
      writeOutput(usage(), false)
      return EXIT.SUCCESS
    }
    const result =
      command === 'serve'
        ? await runServeCommand(commandArguments)
        : await runMcpManagementCommand(command, commandArguments)
    if (command !== 'serve') writeOutput(result, json)
    return EXIT.SUCCESS
  } catch (error) {
    writeError(error, command === 'serve' ? false : json)
    const message = error instanceof Error ? error.message : String(error)
    return exitCodeForError(message)
  }
}

export function mcpCliVersion() {
  return app.getVersion()
}
