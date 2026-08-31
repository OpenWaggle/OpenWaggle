import { spawn } from 'node:child_process'
import { access, mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { verifyInstalledCli } from './verify-installed-cli'

const INSTALLER_ARGUMENT_INDEX = 2
const INSTALLED_EXECUTABLE = 'OpenWaggle.exe'
const INSTALLED_CLI_SHIM = 'openwaggle.cmd'
const INSTALLED_UNINSTALLER = 'Uninstall OpenWaggle.exe'
const SILENT_INSTALL_ARGUMENT = '/S'

type VerifyWindowsInstallerInput = {
  readonly installerPath: string
  readonly installDirectory: string
}

type VerifyWindowsInstallerDependencies = {
  readonly runInstaller?: (installerPath: string, args: readonly string[]) => Promise<number | null>
  readonly runUninstaller?: (uninstallerPath: string, args: readonly string[]) => Promise<number | null>
  readonly verifyCli?: (
    command: string,
    environmentOverrides: Readonly<Record<string, string>>,
  ) => Promise<void>
  readonly verifyPath?: (filePath: string) => Promise<void>
  readonly readUserPath?: () => Promise<string>
  readonly resolveCommand?: (
    command: string,
    environment: Readonly<Record<string, string>>,
  ) => Promise<string>
}

function runInstaller(installerPath: string, args: readonly string[]) {
  return new Promise<number | null>((resolve, reject) => {
    const child = spawn(installerPath, args, { stdio: 'inherit' })
    child.once('error', reject)
    child.once('exit', resolve)
  })
}

function runCaptured(command: string, args: readonly string[], env?: NodeJS.ProcessEnv) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(command, [...args], { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => { stdout += String(chunk) })
    child.stderr.on('data', (chunk) => { stderr += String(chunk) })
    child.once('error', reject)
    child.once('exit', (code) => {
      if (code === 0) resolve(stdout)
      else reject(new Error(`${command} exited with code ${String(code)}: ${stderr}`))
    })
  })
}

async function readUserPath() {
  return (
    await runCaptured('powershell.exe', [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      "[Environment]::GetEnvironmentVariable('Path', 'User')",
    ])
  ).trim()
}

function normalizedWindowsPath(value: string) {
  return value.replaceAll('/', '\\').replace(/[\\]+$/u, '').toLowerCase()
}

export function windowsPathContains(pathValue: string, directory: string) {
  const expected = normalizedWindowsPath(directory)
  return pathValue.split(';').some((entry) => normalizedWindowsPath(entry.trim()) === expected)
}

async function resolveCommand(command: string, environment: Readonly<Record<string, string>>) {
  const output = await runCaptured('where.exe', [command], { ...process.env, ...environment })
  return output.split(/\r?\n/u).find((entry) => entry.trim().length > 0)?.trim() ?? ''
}

async function verifyInstalledState(input: {
  readonly installDirectory: string
  readonly getUserPath: () => Promise<string>
  readonly findCommand: (
    command: string,
    environment: Readonly<Record<string, string>>,
  ) => Promise<string>
  readonly verifyCli: (
    command: string,
    environmentOverrides: Readonly<Record<string, string>>,
  ) => Promise<void>
  readonly verifyPath: (filePath: string) => Promise<void>
}) {
  await input.verifyPath(join(input.installDirectory, INSTALLED_EXECUTABLE))
  const cliShimPath = join(input.installDirectory, INSTALLED_CLI_SHIM)
  await input.verifyPath(cliShimPath)
  await input.verifyPath(join(input.installDirectory, INSTALLED_UNINSTALLER))
  const installedUserPath = await input.getUserPath()
  if (!windowsPathContains(installedUserPath, input.installDirectory)) {
    throw new Error('Windows installer did not add its CLI directory to the user PATH.')
  }
  const freshPath = [installedUserPath, process.env.PATH ?? ''].filter(Boolean).join(';')
  const environmentOverrides = {
    PATH: freshPath,
    PATHEXT: process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD',
  }
  const resolvedCommand = await input.findCommand('openwaggle', environmentOverrides)
  if (normalizedWindowsPath(resolvedCommand) !== normalizedWindowsPath(cliShimPath)) {
    throw new Error(`Fresh shell resolved openwaggle to ${resolvedCommand || 'nothing'}.`)
  }
  await input.verifyCli('openwaggle', environmentOverrides)
}

async function uninstallAndVerify(input: {
  readonly installDirectory: string
  readonly getUserPath: () => Promise<string>
  readonly executeUninstaller: (
    uninstallerPath: string,
    args: readonly string[],
  ) => Promise<number | null>
}) {
  const uninstallerPath = join(input.installDirectory, INSTALLED_UNINSTALLER)
  const exitCode = await input.executeUninstaller(uninstallerPath, [SILENT_INSTALL_ARGUMENT])
  if (exitCode !== 0) throw new Error(`Windows uninstaller exited with code ${String(exitCode)}.`)
  if (windowsPathContains(await input.getUserPath(), input.installDirectory)) {
    throw new Error('Windows uninstaller left its CLI directory in the user PATH.')
  }
}

function throwVerificationFailures(primaryFailure: unknown, cleanupFailure: unknown) {
  if (primaryFailure !== undefined && cleanupFailure !== undefined) {
    throw new AggregateError(
      [primaryFailure, cleanupFailure],
      'Windows installer verification and uninstall both failed.',
    )
  }
  if (primaryFailure !== undefined) throw primaryFailure
  if (cleanupFailure !== undefined) throw cleanupFailure
}

export async function verifyWindowsInstaller(
  input: VerifyWindowsInstallerInput,
  dependencies: VerifyWindowsInstallerDependencies = {},
) {
  const verifyPath = dependencies.verifyPath ?? access
  const executeInstaller = dependencies.runInstaller ?? runInstaller
  const executeUninstaller = dependencies.runUninstaller ?? runInstaller
  const verifyCli =
    dependencies.verifyCli ??
    ((command, environmentOverrides) =>
      verifyInstalledCli(command, 'win32', { environmentOverrides }))
  const getUserPath = dependencies.readUserPath ?? readUserPath
  const findCommand = dependencies.resolveCommand ?? resolveCommand
  await verifyPath(input.installerPath)
  const initialUserPath = await getUserPath()
  if (windowsPathContains(initialUserPath, input.installDirectory)) {
    throw new Error('Isolated Windows install directory was already present in the user PATH.')
  }
  const exitCode = await executeInstaller(input.installerPath, [
    SILENT_INSTALL_ARGUMENT,
    `/D=${input.installDirectory}`,
  ])
  if (exitCode !== 0) throw new Error(`Windows installer exited with code ${String(exitCode)}.`)

  let primaryFailure: unknown
  try {
    await verifyInstalledState({
      installDirectory: input.installDirectory,
      getUserPath,
      findCommand,
      verifyCli,
      verifyPath,
    })
  } catch (error) {
    primaryFailure = error
  }

  let cleanupFailure: unknown
  try {
    await uninstallAndVerify({
      installDirectory: input.installDirectory,
      getUserPath,
      executeUninstaller,
    })
  } catch (error) {
    cleanupFailure = error
  }
  throwVerificationFailures(primaryFailure, cleanupFailure)
}

async function main() {
  const installerPath = process.argv[INSTALLER_ARGUMENT_INDEX]
  if (installerPath === undefined || installerPath.trim().length === 0) {
    throw new Error('Usage: verify-windows-installer.ts <installer-path>')
  }
  const installDirectory = await mkdtemp(join(tmpdir(), 'openwaggle-install-'))
  await verifyWindowsInstaller({ installerPath, installDirectory })
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
