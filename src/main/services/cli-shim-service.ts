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
  /** Test-only interleaving point after update admission and before replacement. */
  readonly beforeManagedReplacement?: () => Promise<void>
  /** Test-only interleaving point before the helper pins the command directory. */
  readonly beforeManagedSpawn?: () => Promise<void>
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

export function createCliShimService(input: CliShimServiceInput) {
  const target = commandPath(input)
  const expectedContent = managedCliShimContent(input)

  async function status(): Promise<CliShimStatus> {
    const unsupported = unsupportedStatus(input)
    if (unsupported) return unsupported
    const current = await readCommand(target)
    const onPath = commandDirectoryIsOnPath(input, target)
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
  return createCliShimService({
    platform: process.platform,
    homeDirectory: os.homedir(),
    executablePath: process.execPath,
    ...(app.isPackaged ? {} : { appPath: app.getAppPath() }),
    environmentPath: env.PATH,
  })
}
