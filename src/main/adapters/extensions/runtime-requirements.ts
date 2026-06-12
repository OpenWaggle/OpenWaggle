import { constants as fsConstants } from 'node:fs'
import { access } from 'node:fs/promises'
import path from 'node:path'
import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import type { OpenWaggleExtensionManifest } from '@shared/schemas/extensions'
import { getSafeChildEnv } from '../../env'
import type { ExtensionDiagnostic } from '../../extensions/types'
import { validateDeclaredFiles } from './package-files'

const WINDOWS_EXECUTABLE_EXTENSIONS = ['.EXE', '.CMD', '.BAT', '.COM'] as const

type RuntimeRequirement = NonNullable<OpenWaggleExtensionManifest['runtimeRequirements']>[number]

export interface DiagnoseRuntimeRequirementsInput {
  readonly packagePath: string
  readonly manifest: OpenWaggleExtensionManifest
}

function runtimeRequirementBinary(requirement: RuntimeRequirement) {
  return requirement.binary ?? null
}

function runtimeRequirementCommand(requirement: RuntimeRequirement) {
  return requirement.command ?? null
}

function pathDirectories() {
  const pathValue = getSafeChildEnv().PATH ?? ''
  return pathValue.split(path.delimiter).filter((entry) => entry.length > 0)
}

function executableCandidates(binary: string) {
  const directories = pathDirectories()
  if (process.platform !== 'win32') {
    return directories.map((directory) => path.join(directory, binary))
  }

  const extension = path.extname(binary)
  const executableNames =
    extension.length > 0
      ? [binary]
      : [binary, ...WINDOWS_EXECUTABLE_EXTENSIONS.map((suffix) => `${binary}${suffix}`)]
  return directories.flatMap((directory) =>
    executableNames.map((executableName) => path.join(directory, executableName)),
  )
}

async function canAccessExecutable(filePath: string) {
  try {
    await access(filePath, process.platform === 'win32' ? fsConstants.F_OK : fsConstants.X_OK)
    return true
  } catch {
    return false
  }
}

async function isBinaryAvailable(binary: string) {
  for (const candidate of executableCandidates(binary)) {
    if (await canAccessExecutable(candidate)) {
      return true
    }
  }
  return false
}

function missingRuntimeRequirementDiagnostic(
  requirement: RuntimeRequirement,
  binary: string,
): ExtensionDiagnostic {
  return {
    severity: OPENWAGGLE_EXTENSION.DIAGNOSTIC.SEVERITY.ERROR,
    code: OPENWAGGLE_EXTENSION.DIAGNOSTIC.CODE.RUNTIME_REQUIREMENT_MISSING,
    message: `Missing runtime requirement "${requirement.label}". Install "${binary}" and ensure it is available on PATH before trusting or enabling this extension. OpenWaggle does not install system binaries automatically.`,
  }
}

function runtimeRequirementCommandPaths(manifest: OpenWaggleExtensionManifest): readonly string[] {
  const commands: string[] = []
  for (const requirement of manifest.runtimeRequirements ?? []) {
    const command = runtimeRequirementCommand(requirement)
    if (command !== null) {
      commands.push(command)
    }
  }
  return commands
}

function diagnosePackageRuntimeRequirementCommands(input: DiagnoseRuntimeRequirementsInput) {
  return validateDeclaredFiles({
    packagePath: input.packagePath,
    relativePaths: runtimeRequirementCommandPaths(input.manifest),
    label: 'runtime requirement command',
    missingCode: OPENWAGGLE_EXTENSION.DIAGNOSTIC.CODE.RUNTIME_REQUIREMENT_MISSING,
  })
}

export async function diagnoseRuntimeRequirements(
  input: DiagnoseRuntimeRequirementsInput,
): Promise<readonly ExtensionDiagnostic[]> {
  const diagnostics: ExtensionDiagnostic[] = []

  for (const requirement of input.manifest.runtimeRequirements ?? []) {
    const binary = runtimeRequirementBinary(requirement)
    if (binary === null || (await isBinaryAvailable(binary))) {
      continue
    }
    diagnostics.push(missingRuntimeRequirementDiagnostic(requirement, binary))
  }

  return [...diagnostics, ...(await diagnosePackageRuntimeRequirementCommands(input))]
}
