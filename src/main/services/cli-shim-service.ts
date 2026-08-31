import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { CliShimMutationResult, CliShimStatus } from '@shared/types/cli-shim'
import { app } from 'electron'
import { env } from '../env'
import { runManagedShimMutation } from './cli-shim-bound-mutation'
import { MANAGED_CLI_SHIM_MARKER, managedCliShimContent } from './cli-shim-content'

export interface CliShimServiceInput {
  readonly platform: NodeJS.Platform
  readonly homeDirectory: string
  readonly executablePath: string
  readonly appPath?: string
  readonly environmentPath?: string
  /** Running legacy quick-install AppImage that occupies the managed command path. */
  readonly legacyLinuxAppImagePath?: string
  /** Test-only interleaving point after update admission and before replacement. */
  readonly beforeManagedReplacement?: () => Promise<void>
  /** Test-only interleaving point after helper revalidation and before mutation. */
  readonly beforeManagedCommit?: () => Promise<void>
  /** Test-only interleaving point after target displacement and before installation. */
  readonly afterManagedDisplacement?: () => Promise<void>
  /** Test-only interleaving point before the helper pins the command directory. */
  readonly beforeManagedSpawn?: (input: {
    readonly directory: string
    readonly pendingName: string
  }) => Promise<void>
}

const LEGACY_LINUX_LAYOUT_ERROR =
  'Re-run the OpenWaggle installer and restart the app to migrate the legacy Linux AppImage layout safely.'

export function resolveCliShimExecutablePath(input: {
  readonly platform: NodeJS.Platform
  readonly executablePath: string
  readonly isPackaged: boolean
  readonly appImagePath?: string
}) {
  if (
    input.platform === 'linux' &&
    input.isPackaged &&
    input.appImagePath &&
    path.isAbsolute(input.appImagePath)
  ) {
    return input.appImagePath
  }
  return input.executablePath
}

function isMissing(error: unknown) {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

function commandDirectoryIsOnPath(input: CliShimServiceInput, commandPath: string) {
  const commandDirectory = path.resolve(path.dirname(commandPath))
  return (input.environmentPath ?? '')
    .split(path.delimiter)
    .filter(Boolean)
    .some((entry) => path.resolve(entry) === commandDirectory)
}

function commandPath(input: CliShimServiceInput) {
  return path.join(input.homeDirectory, '.local', 'bin', 'openwaggle')
}

function usesLegacyLinuxRuntime(input: CliShimServiceInput, target: string) {
  return input.platform === 'linux' && input.legacyLinuxAppImagePath === target
}

async function readCommand(command: string) {
  try {
    const entry = await fs.lstat(command)
    if (!entry.isFile()) return { kind: 'conflict' as const }
    const content = await fs.readFile(command, 'utf8')
    return {
      kind: 'file' as const,
      content,
      identity: `${entry.dev}:${entry.ino}`,
      digest: createHash('sha256').update(content).digest('hex'),
    }
  } catch (error) {
    if (isMissing(error)) return { kind: 'missing' as const }
    throw error
  }
}

function unsupportedStatus(input: CliShimServiceInput): CliShimStatus | null {
  if (input.platform === 'win32') {
    return {
      management: 'installer',
      state: 'installed',
      commandPath: null,
      onPath: true,
      detail: 'The Windows installer manages the openwaggle command.',
    }
  }
  if (input.platform === 'darwin' || input.platform === 'linux') return null
  return {
    management: 'unsupported',
    state: 'unavailable',
    commandPath: null,
    onPath: false,
    detail: `CLI installation is not supported on ${input.platform}.`,
  }
}

function legacyLinuxRuntimeStatus(target: string, onPath: boolean): CliShimStatus {
  return {
    management: 'user-shim',
    state: 'outdated',
    commandPath: target,
    onPath,
    detail: LEGACY_LINUX_LAYOUT_ERROR,
  }
}

export function createCliShimService(input: CliShimServiceInput) {
  const target = commandPath(input)
  const expectedContent = managedCliShimContent(input)

  async function status(): Promise<CliShimStatus> {
    const unsupported = unsupportedStatus(input)
    if (unsupported) return unsupported
    const onPath = commandDirectoryIsOnPath(input, target)
    if (usesLegacyLinuxRuntime(input, target)) return legacyLinuxRuntimeStatus(target, onPath)
    const current = await readCommand(target)
    if (current.kind === 'missing') {
      return { management: 'user-shim', state: 'not-installed', commandPath: target, onPath }
    }
    if (current.kind === 'conflict' || !current.content.includes(MANAGED_CLI_SHIM_MARKER)) {
      return {
        management: 'user-shim',
        state: 'conflict',
        commandPath: target,
        onPath,
        detail: 'Another file already uses this path. OpenWaggle will not replace it.',
      }
    }
    return {
      management: 'user-shim',
      state: current.content === expectedContent ? 'installed' : 'outdated',
      commandPath: target,
      onPath,
    }
  }

  async function install(): Promise<CliShimMutationResult> {
    const before = await status()
    if (before.management !== 'user-shim' || before.state === 'unavailable') {
      return {
        ok: false,
        error: before.detail ?? 'CLI installation is unavailable.',
        status: before,
      }
    }
    if (before.state === 'conflict') {
      return {
        ok: false,
        error: before.detail ?? 'The CLI path is already occupied.',
        status: before,
      }
    }
    if (before.state === 'installed') return { ok: true, status: before }
    if (usesLegacyLinuxRuntime(input, target)) {
      return { ok: false, error: LEGACY_LINUX_LAYOUT_ERROR, status: before }
    }
    try {
      if (before.state === 'not-installed') {
        await runManagedShimMutation({ service: input, target, expectedContent, mode: 'create' })
      } else {
        const current = await readCommand(target)
        if (current.kind !== 'file' || !current.content.includes(MANAGED_CLI_SHIM_MARKER)) {
          throw new Error('The CLI path changed before update; OpenWaggle did not replace it.')
        }
        await runManagedShimMutation({
          service: input,
          target,
          expectedContent,
          expectedTarget: current,
          mode: 'replace',
        })
      }
    } catch (error) {
      const current = await status()
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        status: current,
      }
    }
    return { ok: true, status: await status() }
  }

  async function remove(): Promise<CliShimMutationResult> {
    const before = await status()
    if (before.management !== 'user-shim' || before.state === 'unavailable') {
      return { ok: false, error: before.detail ?? 'CLI removal is unavailable.', status: before }
    }
    if (before.state === 'not-installed') return { ok: true, status: before }
    if (before.state === 'conflict') {
      return {
        ok: false,
        error: before.detail ?? 'The CLI path is not managed by OpenWaggle.',
        status: before,
      }
    }
    const current = await readCommand(target)
    if (current.kind !== 'file' || !current.content.includes(MANAGED_CLI_SHIM_MARKER)) {
      return {
        ok: false,
        error: 'The CLI path changed before removal; OpenWaggle did not delete it.',
        status: await status(),
      }
    }
    try {
      await runManagedShimMutation({
        service: input,
        target,
        expectedTarget: current,
        mode: 'remove',
      })
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        status: await status(),
      }
    }
    return { ok: true, status: await status() }
  }

  return { status, install, remove }
}

export function createAppCliShimService() {
  const homeDirectory = os.homedir()
  const command = path.join(homeDirectory, '.local', 'bin', 'openwaggle')
  const appImagePath = resolveCliShimExecutablePath({
    platform: process.platform,
    executablePath: process.execPath,
    isPackaged: app.isPackaged,
    ...(env.APPIMAGE ? { appImagePath: env.APPIMAGE } : {}),
  })
  const legacyLinuxAppImage =
    process.platform === 'linux' && app.isPackaged && path.resolve(appImagePath) === command
  return createCliShimService({
    platform: process.platform,
    homeDirectory,
    executablePath: appImagePath,
    ...(legacyLinuxAppImage ? { legacyLinuxAppImagePath: command } : {}),
    ...(app.isPackaged ? {} : { appPath: app.getAppPath() }),
    environmentPath: env.PATH,
  })
}
