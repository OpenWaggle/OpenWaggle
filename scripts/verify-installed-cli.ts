import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { applicationCliStdout } from './electron-cli-stdout'
import { prepareQaProfileRemoval, shutdownSessionHostForQa } from './qa/session-host-shutdown'
import { buildSafeElectronEnvironment } from './safe-electron-environment'

const FIRST_USER_ARGUMENT_INDEX = 2
const CLI_TIMEOUT_MS = 30_000
const CLI_MAX_OUTPUT_BYTES = 10 * 1024 * 1024
const WINDOWS_COMMAND_PROCESSOR = 'cmd.exe'

interface CliResult {
  readonly stdout: string
  readonly stderr: string
}

interface VerifyInstalledCliDependencies {
  readonly environmentOverrides?: Readonly<Record<string, string>>
  readonly createProfile?: () => Promise<string>
  readonly runCli?: (
    command: string,
    args: readonly string[],
    environment: Record<string, string>,
    platform: NodeJS.Platform,
  ) => Promise<CliResult>
  readonly shutdownAndRemoveProfile?: (userDataRoot: string) => Promise<void>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function windowsCommand(command: string, args: readonly string[]) {
  return {
    command: WINDOWS_COMMAND_PROCESSOR,
    args: ['/d', '/s', '/c', `"${command}" ${args.join(' ')}`],
  }
}

function installedCliProcess(command: string, args: readonly string[], platform: NodeJS.Platform) {
  return platform === 'win32' ? windowsCommand(command, args) : { command, args }
}

function runInstalledCli(
  command: string,
  args: readonly string[],
  environment: Record<string, string>,
  platform: NodeJS.Platform,
) {
  const processInput = installedCliProcess(command, args, platform)
  return new Promise<CliResult>((resolve, reject) => {
    const child = spawn(processInput.command, [...processInput.args], {
      env: environment,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    let outputBytes = 0
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, CLI_TIMEOUT_MS)
    const collect = (target: Buffer[]) => (chunk: Buffer) => {
      outputBytes += chunk.byteLength
      if (outputBytes > CLI_MAX_OUTPUT_BYTES) {
        child.kill('SIGKILL')
        return
      }
      target.push(chunk)
    }
    child.stdout.on('data', collect(stdout))
    child.stderr.on('data', collect(stderr))
    child.once('error', reject)
    child.once('close', (code, signal) => {
      clearTimeout(timer)
      const stderrText = Buffer.concat(stderr).toString()
      if (timedOut) {
        reject(new Error(`Installed OpenWaggle CLI timed out after ${String(CLI_TIMEOUT_MS)}ms.`))
        return
      }
      if (outputBytes > CLI_MAX_OUTPUT_BYTES) {
        reject(new Error('Installed OpenWaggle CLI exceeded the verification output limit.'))
        return
      }
      if (code !== 0) {
        reject(
          new Error(
            `Installed OpenWaggle CLI exited with ${String(code ?? signal)}: ${stderrText}`,
          ),
        )
        return
      }
      resolve({ stdout: Buffer.concat(stdout).toString(), stderr: stderrText })
    })
  })
}

export function assertInstalledCliResponse(stdout: string, platform: NodeJS.Platform) {
  const normalized = applicationCliStdout(stdout, platform)
  const parsed: unknown = JSON.parse(normalized)
  if (
    !isRecord(parsed) ||
    parsed.schemaVersion !== 1 ||
    parsed.type !== 'response' ||
    parsed.command !== 'list' ||
    !isRecord(parsed.result)
  ) {
    throw new Error('Installed OpenWaggle CLI returned an invalid sessions list response.')
  }
}

async function defaultShutdownAndRemoveProfile(userDataRoot: string) {
  await shutdownSessionHostForQa(userDataRoot, (ownership) =>
    prepareQaProfileRemoval(userDataRoot, ownership),
  )
}

export async function verifyInstalledCli(
  command: string,
  platform: NodeJS.Platform = process.platform,
  dependencies: VerifyInstalledCliDependencies = {},
) {
  const createProfile =
    dependencies.createProfile ??
    (() => fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-installed-cli-')))
  const executeCli = dependencies.runCli ?? runInstalledCli
  const shutdownAndRemoveProfile =
    dependencies.shutdownAndRemoveProfile ?? defaultShutdownAndRemoveProfile
  const userDataRoot = await createProfile()
  const environment = {
    ...buildSafeElectronEnvironment({}),
    ...dependencies.environmentOverrides,
    ...(platform === 'linux' ? { APPIMAGE_EXTRACT_AND_RUN: '1' } : {}),
    OPENWAGGLE_AUTOMATION: '1',
    OPENWAGGLE_DISABLE_SINGLE_INSTANCE: '1',
    OPENWAGGLE_USER_DATA_DIR: userDataRoot,
  }
  let primaryFailure: { readonly error: unknown } | null = null
  try {
    const result = await executeCli(
      command,
      ['sessions', 'list', '--all', '--limit', '1', '--json'],
      environment,
      platform,
    )
    assertInstalledCliResponse(result.stdout, platform)
  } catch (error) {
    primaryFailure = { error }
  }

  try {
    await shutdownAndRemoveProfile(userDataRoot)
  } catch (cleanupError) {
    console.error(`[release-qa] retained installed-CLI profile: ${userDataRoot}`)
    if (primaryFailure) {
      throw new AggregateError(
        [primaryFailure.error, cleanupError],
        'Installed CLI verification and Session Host cleanup both failed.',
        { cause: cleanupError },
      )
    }
    throw cleanupError
  }
  if (primaryFailure) throw primaryFailure.error
}

async function main() {
  const command = process.argv[FIRST_USER_ARGUMENT_INDEX]
  if (command === undefined || command.trim().length === 0) {
    throw new Error('Usage: verify-installed-cli.ts <installed-command>')
  }
  await verifyInstalledCli(path.resolve(command))
  console.log(`installed CLI verification passed: ${command}`)
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error: unknown) => {
    console.error(error)
    process.exitCode = 1
  })
}
