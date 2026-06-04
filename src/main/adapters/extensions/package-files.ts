import { createHash } from 'node:crypto'
import { readFile, realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import { formatErrorMessage, isEnoent } from '@shared/utils/node-error'
import type { ExtensionDiagnostic, ExtensionDiagnosticCode } from '../../extensions/types'
import { isPathInside } from '../../utils/paths'
import { normalizeManifestRelativePath } from './content-hash-input'

export interface ContentHashResult {
  readonly contentHash: string | null
  readonly diagnostics: readonly ExtensionDiagnostic[]
}

export interface ContentHashInput {
  readonly builtArtifacts: readonly string[]
  readonly runtimeFiles: readonly string[]
}

export interface BuildPlanHashInput {
  readonly sourceFiles: readonly string[]
  readonly buildCommand: string
}

interface ContentHashFileInput {
  readonly relativePath: string
  readonly label: string
  readonly missingCode: ExtensionDiagnosticCode
}

export interface ValidateDeclaredFilesInput {
  readonly packagePath: string
  readonly relativePaths: readonly string[]
  readonly label: string
  readonly missingCode: ExtensionDiagnosticCode
}

function resolvePackageRelativePath(packagePath: string, relativePath: string) {
  const resolvedPackagePath = path.resolve(packagePath)
  const resolvedCandidatePath = path.resolve(
    packagePath,
    normalizeManifestRelativePath(relativePath),
  )
  return isPathInside(resolvedPackagePath, resolvedCandidatePath) ? resolvedCandidatePath : null
}

export async function resolveSafePackageFilePath(packagePath: string, relativePath: string) {
  const candidatePath = resolvePackageRelativePath(packagePath, relativePath)
  if (!candidatePath) {
    return null
  }

  const [realPackagePath, realCandidatePath] = await Promise.all([
    realpath(packagePath),
    realpath(candidatePath),
  ])
  return isPathInside(realPackagePath, realCandidatePath) ? realCandidatePath : null
}

async function fileExists(filePath: string) {
  try {
    const fileStat = await stat(filePath)
    return fileStat.isFile()
  } catch (error) {
    if (isEnoent(error)) {
      return false
    }
    throw error
  }
}

export async function validateDeclaredFiles(input: ValidateDeclaredFilesInput) {
  const diagnostics: ExtensionDiagnostic[] = []
  for (const relativePath of input.relativePaths) {
    const candidatePath = resolvePackageRelativePath(input.packagePath, relativePath)
    if (!candidatePath) {
      diagnostics.push({
        severity: 'error',
        code: 'package-path-invalid',
        message: `Declared ${input.label} escapes the extension package root.`,
        path: relativePath,
      })
      continue
    }

    try {
      const filePath = await resolveSafePackageFilePath(input.packagePath, relativePath)
      if (!filePath) {
        diagnostics.push({
          severity: 'error',
          code: 'package-path-invalid',
          message: `Declared ${input.label} resolves outside the extension package root.`,
          path: relativePath,
        })
        continue
      }

      if (!(await fileExists(filePath))) {
        diagnostics.push({
          severity: 'error',
          code: input.missingCode,
          message: `Declared ${input.label} does not exist.`,
          path: filePath,
        })
      }
    } catch (error) {
      diagnostics.push({
        severity: 'error',
        code: isEnoent(error) ? input.missingCode : 'filesystem-error',
        message: isEnoent(error)
          ? `Declared ${input.label} does not exist.`
          : `Failed to inspect declared ${input.label}: ${formatErrorMessage(error)}`,
        path: candidatePath,
      })
    }
  }
  return diagnostics
}

function contentHashFileLabel(missingCode: ExtensionDiagnosticCode) {
  return missingCode === 'runtime-file-missing'
    ? OPENWAGGLE_EXTENSION.LABELS.RUNTIME_FILE
    : OPENWAGGLE_EXTENSION.LABELS.BUILT_ARTIFACT
}

function contentHashFileInput(
  relativePath: string,
  missingCode: ExtensionDiagnosticCode,
): ContentHashFileInput {
  return {
    relativePath,
    label: contentHashFileLabel(missingCode),
    missingCode,
  }
}

function getContentHashFileInputs(input: ContentHashInput) {
  const files: ContentHashFileInput[] = []

  for (const relativePath of input.builtArtifacts) {
    files.push(contentHashFileInput(relativePath, 'built-artifact-missing'))
  }
  for (const relativePath of input.runtimeFiles) {
    files.push(contentHashFileInput(relativePath, 'runtime-file-missing'))
  }

  return files
}

function preferHashFileInput(left: ContentHashFileInput, right: ContentHashFileInput) {
  return left.missingCode === 'runtime-file-missing' ? right : left
}

function uniqueSortedHashFileInputs(files: readonly ContentHashFileInput[]) {
  const byPath = new Map<string, ContentHashFileInput>()
  for (const file of files) {
    const normalizedRelativePath = normalizeManifestRelativePath(file.relativePath)
    const normalizedFile = { ...file, relativePath: normalizedRelativePath }
    const existing = byPath.get(normalizedRelativePath)
    byPath.set(
      normalizedRelativePath,
      existing ? preferHashFileInput(existing, normalizedFile) : normalizedFile,
    )
  }
  return [...byPath.values()].sort((left, right) =>
    left.relativePath.localeCompare(right.relativePath),
  )
}

export async function calculateContentHash(
  packagePath: string,
  rawManifest: string,
  input: ContentHashInput,
): Promise<ContentHashResult> {
  const hash = createHash(OPENWAGGLE_EXTENSION.HASH.ALGORITHM)
  const diagnostics: ExtensionDiagnostic[] = []

  hash.update(OPENWAGGLE_EXTENSION.HASH.MANIFEST_LABEL)
  hash.update(OPENWAGGLE_EXTENSION.HASH.FIELD_SEPARATOR)
  hash.update(rawManifest)
  hash.update(OPENWAGGLE_EXTENSION.HASH.FIELD_SEPARATOR)

  for (const file of uniqueSortedHashFileInputs(getContentHashFileInputs(input))) {
    const candidatePath = resolvePackageRelativePath(packagePath, file.relativePath)
    if (!candidatePath) {
      diagnostics.push({
        severity: 'error',
        code: 'package-path-invalid',
        message: `Declared ${file.label} escapes the extension package root.`,
        path: file.relativePath,
      })
      continue
    }

    try {
      const filePath = await resolveSafePackageFilePath(packagePath, file.relativePath)
      if (!filePath) {
        diagnostics.push({
          severity: 'error',
          code: 'package-path-invalid',
          message: `Declared ${file.label} resolves outside the extension package root.`,
          path: file.relativePath,
        })
        continue
      }

      const content = await readFile(filePath)
      hash.update(OPENWAGGLE_EXTENSION.HASH.ARTIFACT_LABEL)
      hash.update(OPENWAGGLE_EXTENSION.HASH.FIELD_SEPARATOR)
      hash.update(file.relativePath)
      hash.update(OPENWAGGLE_EXTENSION.HASH.FIELD_SEPARATOR)
      hash.update(content)
      hash.update(OPENWAGGLE_EXTENSION.HASH.FIELD_SEPARATOR)
    } catch (error) {
      diagnostics.push({
        severity: 'error',
        code: isEnoent(error) ? file.missingCode : 'filesystem-error',
        message: `Failed to hash ${file.label}: ${formatErrorMessage(error)}`,
        path: candidatePath,
      })
    }
  }

  return {
    contentHash: diagnostics.length === 0 ? hash.digest(OPENWAGGLE_EXTENSION.HASH.ENCODING) : null,
    diagnostics,
  }
}

export async function calculateBuildPlanHash(
  packagePath: string,
  rawManifest: string,
  input: BuildPlanHashInput,
): Promise<ContentHashResult> {
  const hash = createHash(OPENWAGGLE_EXTENSION.HASH.ALGORITHM)
  const diagnostics: ExtensionDiagnostic[] = []

  hash.update(OPENWAGGLE_EXTENSION.HASH.BUILD_PLAN_LABEL)
  hash.update(OPENWAGGLE_EXTENSION.HASH.FIELD_SEPARATOR)
  hash.update(OPENWAGGLE_EXTENSION.HASH.MANIFEST_LABEL)
  hash.update(OPENWAGGLE_EXTENSION.HASH.FIELD_SEPARATOR)
  hash.update(rawManifest)
  hash.update(OPENWAGGLE_EXTENSION.HASH.FIELD_SEPARATOR)
  hash.update(OPENWAGGLE_EXTENSION.HASH.BUILD_COMMAND_LABEL)
  hash.update(OPENWAGGLE_EXTENSION.HASH.FIELD_SEPARATOR)
  hash.update(input.buildCommand)
  hash.update(OPENWAGGLE_EXTENSION.HASH.FIELD_SEPARATOR)

  for (const relativePath of uniqueSortedHashFileInputs(
    input.sourceFiles.map((sourceFile) => contentHashFileInput(sourceFile, 'source-file-missing')),
  )) {
    const candidatePath = resolvePackageRelativePath(packagePath, relativePath.relativePath)
    if (!candidatePath) {
      diagnostics.push({
        severity: 'error',
        code: 'package-path-invalid',
        message: `Declared ${OPENWAGGLE_EXTENSION.LABELS.SOURCE_FILE} escapes the extension package root.`,
        path: relativePath.relativePath,
      })
      continue
    }

    try {
      const filePath = await resolveSafePackageFilePath(packagePath, relativePath.relativePath)
      if (!filePath) {
        diagnostics.push({
          severity: 'error',
          code: 'package-path-invalid',
          message: `Declared ${OPENWAGGLE_EXTENSION.LABELS.SOURCE_FILE} resolves outside the extension package root.`,
          path: relativePath.relativePath,
        })
        continue
      }

      const content = await readFile(filePath)
      hash.update(OPENWAGGLE_EXTENSION.HASH.SOURCE_LABEL)
      hash.update(OPENWAGGLE_EXTENSION.HASH.FIELD_SEPARATOR)
      hash.update(relativePath.relativePath)
      hash.update(OPENWAGGLE_EXTENSION.HASH.FIELD_SEPARATOR)
      hash.update(content)
      hash.update(OPENWAGGLE_EXTENSION.HASH.FIELD_SEPARATOR)
    } catch (error) {
      diagnostics.push({
        severity: 'error',
        code: isEnoent(error) ? 'source-file-missing' : 'filesystem-error',
        message: `Failed to hash ${OPENWAGGLE_EXTENSION.LABELS.SOURCE_FILE}: ${formatErrorMessage(error)}`,
        path: candidatePath,
      })
    }
  }

  return {
    contentHash: diagnostics.length === 0 ? hash.digest(OPENWAGGLE_EXTENSION.HASH.ENCODING) : null,
    diagnostics,
  }
}
