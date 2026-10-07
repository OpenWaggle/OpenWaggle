import path from 'node:path'
import { app } from 'electron'
import { resolveCliProjectPath } from './cli-project-path'
import { writeCliStdout } from './cli-stdout'
import {
  formatMcpCliOutput,
  hasFlag,
  option,
  type ParsedArguments,
  parseMcpCliArguments,
  readSecretFromStdin,
  requireServeScope,
  serveAuthorizationCeiling,
  validateMcpCliOptions,
} from './mcp-cli-arguments'
import { runMcpManagementCommand } from './mcp-cli-management'
import { isMcpManagementCommand } from './mcp-cli-management-arguments'
import { createMcpCliHost } from './mcp-cli-management-host'
import {
  OPENWAGGLE_MCP_SERVE_GRANTS,
  type OpenWaggleMcpServeGrant,
  serveOpenWaggleMcpServer,
} from './openwaggle-mcp-server'
import { canonicalizeExistingProjectPath } from './openwaggle-mcp-workspace-policy'

const EXIT = { SUCCESS: 0, FAILURE: 1, USAGE: 2, NOT_FOUND: 3, POLICY: 4 } as const

function usage() {
  return `OpenWaggle MCP

Usage:
  openwaggle mcp add <server> [options] -- <command> [args...]
  openwaggle mcp add <server> [options] --url <url>
  openwaggle mcp remove <server> [-l]
  openwaggle mcp list [--json] [-l]
  openwaggle mcp enable|disable <server> [-l] [--in-project]
  openwaggle mcp login|logout <server> [-l]
  openwaggle mcp import [--from <tools>] [--apply] [--server <name>]...
                        [--conflict skip|replace|rename] [--json] [-l]
  openwaggle mcp serve --stdio [--profile <name>] [--grant <capability>]...
                       [--authorization-ceiling ask-for-approval|yolo]
                       [--workspace <path>]... [--session <id>]...
                       [--export-root <path>]...
                       [--attachment-root <path>]...
                       [--origin-session <id>]
  openwaggle mcp serve --http <port> --token-stdin [--profile <name>]
                       [--authorization-ceiling ask-for-approval|yolo]
                       [--grant <capability>]... [--workspace <path>]...
                       [--export-root <path>]...
                       [--attachment-root <path>]...
                       [--session <id>]... [--origin-session <id>]

Server scope: at least one --workspace <path> or --session <id> is required.
Unexpected positional and -- passthrough input fail before the server starts.

Servers are read from ~/.pi/agent/mcp.json and ~/.openwaggle/mcp.json, and with -l
(or --project <path>) also from the project's .mcp.json, .pi/mcp.json, and
.openwaggle/mcp.json. New servers go to OpenWaggle's file: ~/.openwaggle/mcp.json, or
.openwaggle/mcp.json with -l. Changes to a server are saved to the file that defines it.

Options for add:
  --url <url>                    Streamable HTTP server URL (instead of a command)
  --env <KEY=VALUE>              Environment variable for a stdio server (repeatable)
  --env-secret <KEY=NAME>        Environment variable from the vault (OpenWaggle files only)
  --cwd <dir>                    Working directory for a stdio server
  --header <KEY=VALUE>           HTTP header (repeatable)
  --header-secret <KEY=NAME>     HTTP header from the vault (OpenWaggle files only)
  --bearer-token-env-var <NAME>  Send "Authorization: Bearer \${NAME}"
  --oauth-client-id <id>, --oauth-client-secret <secret>,
  --oauth-callback-port <port>, --oauth-client-name <name>
  --exposure <mode>              codemode (default), deferred, direct, or hidden
  --description <text>           What the server offers
  --file <file>                  pi-global, openwaggle-global, project-mcp-json,
                                 project-pi, or project-openwaggle

Options for enable and disable:
  --in-project                   Switch a global server for this project only

Options for import:
  --from <tools>                 codex, claude-code, claude-desktop, cursor, vscode,
                                 opencode, zed, windsurf (comma-separated)
  --apply                        Import new servers, or those named with --server
`
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
    workspaceRoots: scope.workspaces.map((entry) =>
      canonicalizeExistingProjectPath(path.resolve(entry)),
    ),
    exportRoots: (arguments_.options.get('export-root') ?? []).map((entry) =>
      canonicalizeExistingProjectPath(path.resolve(entry)),
    ),
    attachmentRoots: (arguments_.options.get('attachment-root') ?? []).map((entry) =>
      canonicalizeExistingProjectPath(path.resolve(entry)),
    ),
    sessionIds: new Set(scope.sessions),
    ...(originSessionId ? { originSessionId } : {}),
    profile,
    authorizationCeiling: serveAuthorizationCeiling(arguments_),
    userDataRoot: app.getPath('userData'),
    version: app.getVersion(),
    stderr: process.stderr,
  })
}

function writeOutput(value: unknown, json: boolean) {
  return writeCliStdout(`${formatMcpCliOutput(value, json)}\n`)
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
    'Unsupported MCP command',
    'MCP ',
    'Missing value',
  ]
  if (usagePrefixes.some((prefix) => message.startsWith(prefix))) return EXIT.USAGE
  if (message.includes('require')) return EXIT.POLICY
  return EXIT.FAILURE
}

export function getMcpCliArguments(argv: readonly string[]) {
  const marker = argv.indexOf('mcp')
  return marker < 0 ? null : argv.slice(marker + 1)
}

export async function runMcpCli(args: readonly string[]) {
  const [first, ...rest] = args
  if (isMcpManagementCommand(first)) {
    const end = rest.indexOf('--')
    const options = end < 0 ? rest : rest.slice(0, end)
    if (options.includes('--help') || options.includes('-h')) {
      await writeOutput(usage(), false)
      return EXIT.SUCCESS
    }
    return runMcpManagementCommand(first, rest, {
      host: createMcpCliHost(),
      output: {
        log: (text) => void writeCliStdout(`${text}\n`),
        error: (text) => process.stderr.write(`${text}\n`),
      },
      workingDirectory: process.cwd(),
      resolveProjectPath: resolveCliProjectPath,
    })
  }
  const parsed = parseMcpCliArguments(args)
  const command = parsed.positionals[0]
  const commandArguments = { ...parsed, positionals: parsed.positionals.slice(1) }
  const json = hasFlag(parsed, 'json')
  try {
    validateMcpCliOptions(command ?? 'help', commandArguments)
    if (!command || command === 'help') {
      await writeOutput(usage(), false)
      return EXIT.SUCCESS
    }
    await runServeCommand(commandArguments)
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
