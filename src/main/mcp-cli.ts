import path from 'node:path'
import { app } from 'electron'
import { asUsageErrorsSync, CLI_EXIT, cliExitCodeForKind } from './cli-error'
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
  validateMcpCliOptions,
} from './mcp-cli-arguments'
import { runMcpManagementCommand } from './mcp-cli-management'
import { isMcpManagementCommand } from './mcp-cli-management-arguments'
import { createMcpCliHost } from './mcp-cli-management-host'
import { parseServeIdentity, resolveServeIdentity } from './mcp-cli-serve-identity'
import { serveUsage } from './mcp-cli-serve-usage'
import {
  OPENWAGGLE_MCP_SERVE_GRANTS,
  type OpenWaggleMcpServeGrant,
  serveOpenWaggleMcpServer,
} from './openwaggle-mcp-server'
import { canonicalizeExistingProjectPath } from './openwaggle-mcp-workspace-policy'
import { writeSessionsCliError } from './sessions-cli-output'

const EXIT = CLI_EXIT

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
  openwaggle mcp registry search [<query>] [--json]
  openwaggle mcp registry get <name> [--version <version>] [--json]
  openwaggle mcp registry add <name> [--package npm|pypi|nuget|oci|mcpb]
                              [--name <server>] [--version <version>]
                              [--scope global|project] [--exposure <mode>] [-l]
  openwaggle mcp doctor [--json] [-l]
  openwaggle mcp serve --stdio (--profile <name> | --owner)
                       --grant <capability>... (--workspace <path> | --session <id>)...
                       [--profile-credential-file <path>]
                       [--authorization-ceiling ask-for-approval|yolo]
                       [--export-root <path>]... [--attachment-root <path>]...
                       [--origin-session <id>]
  openwaggle mcp serve --http <port> --token-stdin (--profile <name> | --owner)
                       --grant <capability>... (--workspace <path> | --session <id>)...
                       [same options as --stdio]

Run "openwaggle mcp serve --help" for what each server option means.

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
  --exposure <mode>              codemode (default), deferred, or hidden
  --description <text>           What the server offers
  --file <file>                  pi-global, openwaggle-global, project-mcp-json,
                                 project-pi, or project-openwaggle

Options for enable and disable:
  --in-project                   Switch a global server for this project only

Options for import:
  --from <tools>                 codex, claude-code, claude-desktop, cursor, vscode,
                                 opencode, zed, windsurf (comma-separated)
  --apply                        Import new servers, or those named with --server

Options for registry:
  --package <type>               Run a package instead of the hosted URL
  --name <server>                Name in the MCP file (default: the last part of <name>)
  --registry <url>               Another MCP Registry (HTTPS)
  Registry servers are saved to OpenWaggle's file like any other new server. Bundles
  (mcpb) are checked against their SHA-256 and unpacked under ~/.openwaggle/mcp.

doctor lists the MCP files, the errors found in them, and each server's state,
connecting to every enabled server.
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

/** Everything `serve` reads from its command line; what it rejects is a usage error. */
function readServeCommand(arguments_: ParsedArguments) {
  const { stdio, http, httpPort } = parseServeTransport(arguments_)
  const { identity, originSessionId } = parseServeIdentity(arguments_, stdio)
  const scope = requireServeScope(arguments_)
  const grants = parseServeGrants(arguments_.options.get('grant'))
  if (grants.size === 0) {
    throw new Error(
      `Server mode requires at least one --grant <capability>; without one every operation would be refused. Supported grants: ${OPENWAGGLE_MCP_SERVE_GRANTS.join(', ')}.`,
    )
  }
  const roots = (name: string) =>
    (arguments_.options.get(name) ?? []).map((entry) =>
      canonicalizeExistingProjectPath(path.resolve(entry)),
    )
  return {
    stdio,
    http,
    httpPort,
    identity,
    originSessionId,
    grants,
    sessions: scope.sessions,
    workspaceRoots: scope.workspaces.map((entry) =>
      canonicalizeExistingProjectPath(path.resolve(entry)),
    ),
    exportRoots: roots('export-root'),
    attachmentRoots: roots('attachment-root'),
  }
}

async function runServeCommand(arguments_: ParsedArguments) {
  const command = asUsageErrorsSync(() => readServeCommand(arguments_))
  const userDataRoot = app.getPath('userData')
  await serveOpenWaggleMcpServer({
    transport: command.stdio ? 'stdio' : 'streamable-http',
    ...(command.httpPort === undefined ? {} : { httpPort: command.httpPort }),
    ...(command.http ? { bearerToken: await readSecretFromStdin() } : {}),
    grants: command.grants,
    workspaceRoots: command.workspaceRoots,
    exportRoots: command.exportRoots,
    attachmentRoots: command.attachmentRoots,
    sessionIds: new Set(command.sessions),
    ...(command.originSessionId ? { originSessionId: command.originSessionId } : {}),
    identity: await resolveServeIdentity(command.identity, userDataRoot),
    userDataRoot,
    version: app.getVersion(),
    stderr: process.stderr,
  })
}

function writeOutput(value: unknown, json: boolean) {
  return writeCliStdout(`${formatMcpCliOutput(value, json)}\n`)
}

/** The usage text a help request asks for, after validating it, or undefined to run serve. */
function helpText(
  command: string | undefined,
  parsed: ParsedArguments,
  commandArguments: ParsedArguments,
) {
  if (command === '-h' || (!command && parsed.options.has('help'))) return usage()
  if (command === 'serve' && isServeHelp(commandArguments)) return serveUsage()
  validateMcpCliOptions(command ?? 'help', commandArguments)
  if (command === 'help' && commandArguments.positionals.length > 0) {
    if (commandArguments.positionals[0] !== 'serve') {
      throw new Error(`Unsupported MCP command: ${commandArguments.positionals[0]}.`)
    }
    return serveUsage()
  }
  return !command || command === 'help' ? usage() : undefined
}

function isServeHelp(arguments_: ParsedArguments) {
  return (
    arguments_.options.has('help') ||
    arguments_.positionals.includes('-h') ||
    arguments_.positionals.includes('help')
  )
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
    const help = asUsageErrorsSync(() => helpText(command, parsed, commandArguments))
    if (help !== undefined) {
      await writeOutput(help, false)
      return EXIT.SUCCESS
    }
    await runServeCommand(commandArguments)
    return EXIT.SUCCESS
  } catch (error) {
    return cliExitCodeForKind(writeSessionsCliError(error, command === 'serve' ? false : json))
  }
}

export function mcpCliVersion() {
  return app.getVersion()
}
