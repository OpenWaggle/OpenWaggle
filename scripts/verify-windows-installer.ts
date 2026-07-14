import { spawn } from 'node:child_process'
import { access, mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'

const INSTALLER_ARGUMENT_INDEX = 2
const INSTALLED_EXECUTABLE = 'OpenWaggle.exe'
const SILENT_INSTALL_ARGUMENT = '/S'

type VerifyWindowsInstallerInput = {
  readonly installerPath: string
  readonly installDirectory: string
}

type VerifyWindowsInstallerDependencies = {
  readonly runInstaller?: (installerPath: string, args: readonly string[]) => Promise<number | null>
  readonly verifyPath?: (filePath: string) => Promise<void>
}

function runInstaller(installerPath: string, args: readonly string[]) {
  return new Promise<number | null>((resolve, reject) => {
    const child = spawn(installerPath, args, { stdio: 'inherit' })
    child.once('error', reject)
    child.once('exit', resolve)
  })
}

export async function verifyWindowsInstaller(
  input: VerifyWindowsInstallerInput,
  dependencies: VerifyWindowsInstallerDependencies = {},
) {
  const verifyPath = dependencies.verifyPath ?? access
  const executeInstaller = dependencies.runInstaller ?? runInstaller
  await verifyPath(input.installerPath)

  const exitCode = await executeInstaller(input.installerPath, [
    SILENT_INSTALL_ARGUMENT,
    `/D=${input.installDirectory}`,
  ])
  if (exitCode !== 0) {
    throw new Error(`Windows installer exited with code ${String(exitCode)}.`)
  }

  await verifyPath(join(input.installDirectory, INSTALLED_EXECUTABLE))
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
