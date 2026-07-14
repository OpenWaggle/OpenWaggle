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

interface HashFileReadSuccess {
  readonly ok: true
  readonly file: ContentHashFileInput
  readonly content: Buffer
}

interface HashFileReadFailure {
  readonly ok: false
  readonly diagnostic: ExtensionDiagnostic
}

type HashFileReadResult = HashFileReadSuccess | HashFileReadFailure

export interface ValidateDeclaredFilesInput {
  readonly packagePath: string
  readonly relativePaths: readonly string[]
  readonly label: string
  readonly missingCode: ExtensionDiagnosticCode
}

async function validateDeclaredFile(
  input: ValidateDeclaredFilesInput,
  relativePath: string,
): Promise<ExtensionDiagnostic | null> {
  const candidatePath = resolvePackageRelativePath(input.packagePath, relativePath)
  if (!candidatePath) {
    return {
      severity: 'error',
      code: 'package-path-invalid',
      message: `Declared ${input.label} escapes the extension package root.`,
      path: relativePath,
    }
  }

  try {
    const filePath = await resolveSafePackageFilePath(input.packagePath, relativePath)
    if (!filePath) {
      return {
        severity: 'error',
        code: 'package-path-invalid',
        message: `Declared ${input.label} resolves outside the extension package root.`,
        path: relativePath,
      }
    }

    if (await fileExists(filePath)) {
      return null
    }
    return {
      severity: 'error',
      code: input.missingCode,
      message: `Declared ${input.label} does not exist.`,
      path: filePath,
    }
  } catch (error) {
    return {
      severity: 'error',
      code: isEnoent(error) ? input.missingCode : 'filesystem-error',
      message: isEnoent(error)
        ? `Declared ${input.label} does not exist.`
        : `Failed to inspect declared ${input.label}: ${formatErrorMessage(error)}`,
      path: candidatePath,
    }
  }
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
  const results = await Promise.all(
    input.relativePaths.map((relativePath) => validateDeclaredFile(input, relativePath)),
  )
  return results.flatMap((diagnostic) => (diagnostic === null ? [] : [diagnostic]))
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

async function readHashFile(
  packagePath: string,
  file: ContentHashFileInput,
): Promise<HashFileReadResult> {
  const candidatePath = resolvePackageRelativePath(packagePath, file.relativePath)
  if (!candidatePath) {
    return {
      ok: false,
      diagnostic: {
        severity: 'error',
        code: 'package-path-invalid',
        message: `Declared ${file.label} escapes the extension package root.`,
        path: file.relativePath,
      },
    }
  }

  try {
    const filePath = await resolveSafePackageFilePath(packagePath, file.relativePath)
    if (!filePath) {
      return {
        ok: false,
        diagnostic: {
          severity: 'error',
          code: 'package-path-invalid',
          message: `Declared ${file.label} resolves outside the extension package root.`,
          path: file.relativePath,
        },
      }
    }

    return { ok: true, file, content: await readFile(filePath) }
  } catch (error) {
    return {
      ok: false,
      diagnostic: {
        severity: 'error',
        code: isEnoent(error) ? file.missingCode : 'filesystem-error',
        message: `Failed to hash ${file.label}: ${formatErrorMessage(error)}`,
        path: candidatePath,
      },
    }
  }
}

export async function calculateContentHash(
  packagePath: string,
  rawManifest: string,
  input: ContentHashInput,
): Promise<ContentHashResult> {
  const hash = createHash(OPENWAGGLE_EXTENSION.HASH.ALGORITHM)
  const diagnostics: ExtensionDiagnostic[] = []
  const { FIELD_SEPARATOR } = OPENWAGGLE_EXTENSION.HASH

  hash.update(OPENWAGGLE_EXTENSION.HASH.MANIFEST_LABEL)
  hash.update(FIELD_SEPARATOR)
  hash.update(rawManifest)
  hash.update(FIELD_SEPARATOR)

  const files = uniqueSortedHashFileInputs(getContentHashFileInputs(input))
  const fileReads = await Promise.all(files.map((file) => readHashFile(packagePath, file)))
  for (const fileRead of fileReads) {
    if (!fileRead.ok) {
      diagnostics.push(fileRead.diagnostic)
      continue
    }

    hash.update(OPENWAGGLE_EXTENSION.HASH.ARTIFACT_LABEL)
    hash.update(FIELD_SEPARATOR)
    hash.update(fileRead.file.relativePath)
    hash.update(FIELD_SEPARATOR)
    hash.update(fileRead.content)
    hash.update(FIELD_SEPARATOR)
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
  const { FIELD_SEPARATOR } = OPENWAGGLE_EXTENSION.HASH

  hash.update(OPENWAGGLE_EXTENSION.HASH.BUILD_PLAN_LABEL)
  hash.update(FIELD_SEPARATOR)
  hash.update(OPENWAGGLE_EXTENSION.HASH.MANIFEST_LABEL)
  hash.update(FIELD_SEPARATOR)
  hash.update(rawManifest)
  hash.update(FIELD_SEPARATOR)
  hash.update(OPENWAGGLE_EXTENSION.HASH.BUILD_COMMAND_LABEL)
  hash.update(FIELD_SEPARATOR)
  hash.update(input.buildCommand)
  hash.update(FIELD_SEPARATOR)

  const sourceFiles = uniqueSortedHashFileInputs(
    input.sourceFiles.map((sourceFile) => ({
      ...contentHashFileInput(sourceFile, 'source-file-missing'),
      label: OPENWAGGLE_EXTENSION.LABELS.SOURCE_FILE,
    })),
  )
  const fileReads = await Promise.all(
    sourceFiles.map((sourceFile) => readHashFile(packagePath, sourceFile)),
  )
  for (const fileRead of fileReads) {
    if (!fileRead.ok) {
      diagnostics.push(fileRead.diagnostic)
      continue
    }

    hash.update(OPENWAGGLE_EXTENSION.HASH.SOURCE_LABEL)
    hash.update(FIELD_SEPARATOR)
    hash.update(fileRead.file.relativePath)
    hash.update(FIELD_SEPARATOR)
    hash.update(fileRead.content)
    hash.update(FIELD_SEPARATOR)
  }

  return {
    contentHash: diagnostics.length === 0 ? hash.digest(OPENWAGGLE_EXTENSION.HASH.ENCODING) : null,
    diagnostics,
  }
}
