import { constants } from 'node:fs'
import { access, chmod, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, dirname, isAbsolute, join, resolve } from 'node:path'
import type { McpTurnSnapshot, McpTurnSnapshotServer } from '@shared/types/mcp'
import { getSafeChildEnv } from '../../../env'

const ISOLATED_TEMP_DIRECTORY_MODE = 0o700

export interface SandboxedStdioCommand {
  readonly command: string
  readonly args: string[]
  readonly cwd: string
  readonly env: Record<string, string>
  readonly sandbox: 'macos-seatbelt' | 'linux-bubblewrap' | 'explicitly-unsandboxed'
  readonly cleanup?: () => Promise<void>
}

function stringEnv(values: Readonly<Record<string, string | undefined>>) {
  return Object.fromEntries(
    Object.entries(values).filter((entry): entry is [string, string] => entry[1] !== undefined),
  )
}

async function isExecutable(filePath: string) {
  try {
    await access(filePath, constants.X_OK)
    return true
  } catch {
    return false
  }
}

async function resolveExecutable(command: string, cwd: string, env: Record<string, string>) {
  if (command.includes('/') || command.includes('\\')) {
    const resolved = isAbsolute(command) ? command : resolve(cwd, command)
    if (await isExecutable(resolved)) return resolved
    throw new Error(`MCP executable is not accessible: ${resolved}.`)
  }

  for (const directory of (env.PATH ?? '').split(delimiter)) {
    if (!directory) continue
    const candidate = join(directory, command)
    if (await isExecutable(candidate)) return candidate
  }
  throw new Error(`MCP executable was not found on the safe PATH: ${command}.`)
}

function resolveGrantRoots(projectPath: string, roots: readonly string[] | undefined) {
  return (roots ?? []).map((root) =>
    isAbsolute(root) ? resolve(root) : resolve(projectPath, root),
  )
}

export function resolveStdioExecutionPaths(
  snapshot: McpTurnSnapshot,
  server: McpTurnSnapshotServer,
) {
  const { definition, permissions } = server
  const projectPath = snapshot.executionPath ?? snapshot.projectPath
  const cwd = definition.cwd
    ? isAbsolute(definition.cwd)
      ? resolve(definition.cwd)
      : resolve(projectPath, definition.cwd)
    : projectPath
  return {
    projectPath,
    cwd,
    readRoots: resolveGrantRoots(projectPath, permissions.readRoots),
    writeRoots: resolveGrantRoots(projectPath, permissions.writeRoots),
  }
}

function seatbeltPathRule(operation: string, filePath: string) {
  return `(allow ${operation} (subpath ${JSON.stringify(filePath)}))`
}

export function createMacosProfile(input: {
  readonly executable: string
  readonly cwd: string
  readonly temporaryDirectory: string
  readonly readRoots: readonly string[]
  readonly writeRoots: readonly string[]
  readonly allowNetwork: boolean
}) {
  const systemReadRoots = ['/System', '/Library', '/usr', '/bin', '/sbin', '/private/etc']
  const readRoots = new Set([
    ...systemReadRoots,
    dirname(input.executable),
    input.temporaryDirectory,
    ...input.readRoots,
  ])
  const writeRoots = new Set([input.temporaryDirectory, ...input.writeRoots])
  return [
    '(version 1)',
    '(deny default)',
    '(allow process-exec process-fork process-info*)',
    '(allow signal (target self))',
    '(allow sysctl-read)',
    '(allow mach-lookup)',
    ...[...readRoots].map((root) => seatbeltPathRule('file-read*', root)),
    ...[...writeRoots].map((root) => seatbeltPathRule('file-write*', root)),
    ...(input.allowNetwork ? ['(allow network-outbound)'] : []),
  ].join('\n')
}

function addReadBind(args: string[], root: string) {
  args.push('--ro-bind-try', root, root)
}

function addWriteBind(args: string[], root: string) {
  args.push('--bind-try', root, root)
}

async function createLinuxCommand(input: {
  readonly executable: string
  readonly args: readonly string[]
  readonly cwd: string
  readonly env: Record<string, string>
  readonly readRoots: readonly string[]
  readonly writeRoots: readonly string[]
  readonly allowNetwork: boolean
}): Promise<SandboxedStdioCommand> {
  const bwrap = await resolveExecutable('bwrap', input.cwd, input.env).catch(() => null)
  if (!bwrap) {
    throw new Error(
      'A trusted stdio MCP server requires bubblewrap on Linux. Install bwrap or explicitly approve unsandboxed execution.',
    )
  }
  const args = [
    '--die-with-parent',
    '--new-session',
    '--unshare-all',
    ...(input.allowNetwork ? ['--share-net'] : []),
    '--proc',
    '/proc',
    '--dev',
    '/dev',
    '--tmpfs',
    '/tmp',
  ]
  for (const root of ['/usr', '/bin', '/sbin', '/lib', '/lib64', '/etc']) addReadBind(args, root)
  for (const root of new Set([dirname(input.executable), input.cwd, ...input.readRoots])) {
    addReadBind(args, root)
  }
  for (const root of input.writeRoots) addWriteBind(args, root)
  args.push('--chdir', input.cwd, '--', input.executable, ...input.args)
  return { command: bwrap, args, cwd: input.cwd, env: input.env, sandbox: 'linux-bubblewrap' }
}

export async function createSandboxedStdioCommand(input: {
  readonly snapshot: McpTurnSnapshot
  readonly server: McpTurnSnapshotServer
  readonly resolvedEnv: Readonly<Record<string, string>>
}): Promise<SandboxedStdioCommand> {
  const definition = input.server.definition
  if (!definition.command) throw new Error('Stdio MCP server is missing its executable command.')
  const executionPaths = resolveStdioExecutionPaths(input.snapshot, input.server)
  const { cwd } = executionPaths
  const env = {
    ...stringEnv(getSafeChildEnv()),
    ...input.resolvedEnv,
  }
  const executable = await resolveExecutable(definition.command, cwd, env)
  const args = [...(definition.args ?? [])]

  if (input.server.allowUnsandboxed) {
    return { command: executable, args, cwd, env, sandbox: 'explicitly-unsandboxed' }
  }

  const { readRoots, writeRoots } = executionPaths
  const allowNetwork = input.server.permissions.allowNetwork

  if (process.platform === 'darwin') {
    const sandboxExec = '/usr/bin/sandbox-exec'
    if (!(await isExecutable(sandboxExec))) {
      throw new Error(
        'The macOS MCP sandbox is unavailable. Explicitly approve unsandboxed execution to continue.',
      )
    }
    const temporaryDirectory = await mkdtemp(join(tmpdir(), 'openwaggle-mcp-stdio-'))
    await chmod(temporaryDirectory, ISOLATED_TEMP_DIRECTORY_MODE)
    const profile = createMacosProfile({
      executable,
      cwd,
      temporaryDirectory,
      readRoots,
      writeRoots,
      allowNetwork,
    })
    return {
      command: sandboxExec,
      args: ['-p', profile, executable, ...args],
      cwd,
      env: {
        ...env,
        TEMP: temporaryDirectory,
        TMP: temporaryDirectory,
        TMPDIR: temporaryDirectory,
      },
      sandbox: 'macos-seatbelt',
      cleanup: () => rm(temporaryDirectory, { recursive: true, force: true }),
    }
  }

  if (process.platform === 'linux') {
    return createLinuxCommand({
      executable,
      args,
      cwd,
      env: { ...env, TEMP: '/tmp', TMP: '/tmp', TMPDIR: '/tmp' },
      readRoots,
      writeRoots,
      allowNetwork,
    })
  }

  throw new Error(
    process.platform === 'win32'
      ? 'Windows has no OS-level sandbox for local MCP servers yet (ADR-0014). Use a remote MCP server, or explicitly approve unsandboxed execution to accept full user-level access.'
      : 'This platform has no configured MCP stdio sandbox. Explicitly approve unsandboxed execution to continue.',
  )
}
