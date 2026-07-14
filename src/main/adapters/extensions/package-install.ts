import { randomUUID } from 'node:crypto'
import { mkdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import { parseJsonUnknown, safeDecodeUnknown } from '@shared/schema'
import { isExtensionId, isPortableRelativePath } from '@shared/schemas/extension-schema-primitives'
import { openWaggleExtensionManifestSchema } from '@shared/schemas/extensions'
import { isEnoent } from '@shared/utils/node-error'
import type { ExtensionPackageScope } from '../../extensions/types'
import type {
  ExtensionPackageFileWrite,
  ExtensionPackageWriteMode,
  RemoveExtensionPackageInput,
  RemoveExtensionPackageResult,
  WriteExtensionPackageInput,
  WriteExtensionPackageResult,
} from '../../ports/extension-package-repository'
import { isPathInside } from '../../utils/paths'
import { normalizeManifestRelativePath } from './content-hash-input'
import { getProjectExtensionRoot } from './extension-paths'

const EXTENSION_INSTALL_STAGING_DIR = '.openwaggle-extension-installs'
const EXTENSION_INSTALL_BACKUP_SUFFIX = 'backup'

interface FilesystemExtensionPackageRootInput {
  readonly scope: ExtensionPackageScope
  readonly globalRootPath: string
}

interface FilesystemWriteExtensionPackageInput extends WriteExtensionPackageInput {
  readonly globalRootPath: string
}

interface FilesystemRemoveExtensionPackageInput extends RemoveExtensionPackageInput {
  readonly globalRootPath: string
}

interface NormalizedPackageFileWrite extends ExtensionPackageFileWrite {
  readonly normalizedRelativePath: string
}

function validateExtensionId(extensionId: string) {
  const result = isExtensionId(extensionId)
  if (result !== true) {
    throw new Error(`Invalid extension id "${extensionId}": ${result}`)
  }
}

function extensionRootPath(input: FilesystemExtensionPackageRootInput) {
  return input.scope.kind === OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND
    ? input.globalRootPath
    : getProjectExtensionRoot(input.scope.projectPath)
}

function extensionPackagePath(input: {
  readonly extensionId: string
  readonly scope: ExtensionPackageScope
  readonly globalRootPath: string
}) {
  validateExtensionId(input.extensionId)

  const rootPath = path.resolve(extensionRootPath(input))
  const packagePath = path.resolve(rootPath, input.extensionId)
  if (!isPathInside(rootPath, packagePath)) {
    throw new Error(`Extension package path escapes extension root: ${input.extensionId}`)
  }

  return {
    rootPath,
    packagePath,
    manifestPath: path.join(packagePath, OPENWAGGLE_EXTENSION.MANIFEST_FILE),
  }
}

function validateRelativePath(relativePath: string) {
  const result = isPortableRelativePath(relativePath)
  if (result !== true) {
    throw new Error(`Invalid extension package file path "${relativePath}": ${result}`)
  }
  return normalizeManifestRelativePath(relativePath)
}

function normalizePackageFiles(files: readonly ExtensionPackageFileWrite[]) {
  if (files.length === 0) {
    throw new Error('Extension package writes must include at least one file.')
  }

  const seenRelativePaths = new Set<string>()
  const normalizedFiles: NormalizedPackageFileWrite[] = []
  let manifestIncluded = false

  for (const file of files) {
    const normalizedRelativePath = validateRelativePath(file.relativePath)
    if (seenRelativePaths.has(normalizedRelativePath)) {
      throw new Error(`Duplicate extension package file path "${normalizedRelativePath}".`)
    }
    seenRelativePaths.add(normalizedRelativePath)
    if (normalizedRelativePath === OPENWAGGLE_EXTENSION.MANIFEST_FILE) {
      manifestIncluded = true
    }
    normalizedFiles.push({ ...file, normalizedRelativePath })
  }

  if (!manifestIncluded) {
    throw new Error(`Extension package writes must include ${OPENWAGGLE_EXTENSION.MANIFEST_FILE}.`)
  }

  return normalizedFiles.sort((left, right) =>
    left.normalizedRelativePath.localeCompare(right.normalizedRelativePath),
  )
}

function validatePackageManifestIdentity(input: {
  readonly extensionId: string
  readonly files: readonly NormalizedPackageFileWrite[]
}) {
  const manifestFile = input.files.find(
    (file) => file.normalizedRelativePath === OPENWAGGLE_EXTENSION.MANIFEST_FILE,
  )
  if (!manifestFile) {
    throw new Error(`Extension package writes must include ${OPENWAGGLE_EXTENSION.MANIFEST_FILE}.`)
  }

  let parsedManifest: unknown
  try {
    parsedManifest = parseJsonUnknown(manifestFile.content)
  } catch {
    throw new Error(
      `Extension package writes must include a valid ${OPENWAGGLE_EXTENSION.MANIFEST_FILE} manifest.`,
    )
  }

  const decoded = safeDecodeUnknown(openWaggleExtensionManifestSchema, parsedManifest)
  if (!decoded.success) {
    throw new Error(
      `Extension package writes must include a valid ${OPENWAGGLE_EXTENSION.MANIFEST_FILE} manifest. ${decoded.issues.join('; ')}`,
    )
  }
  if (decoded.data.id !== input.extensionId) {
    throw new Error(
      `Extension package manifest id must match requested extension id. Expected "${input.extensionId}", received "${decoded.data.id}".`,
    )
  }
}

async function pathExists(filePath: string) {
  try {
    await stat(filePath)
    return true
  } catch (error) {
    if (isEnoent(error)) {
      return false
    }
    throw error
  }
}

function assertWriteMode(input: {
  readonly mode: ExtensionPackageWriteMode
  readonly packagePath: string
  readonly exists: boolean
}) {
  if (input.mode === 'create' && input.exists) {
    throw new Error(`Extension package already exists: ${input.packagePath}`)
  }
  if (input.mode === 'update' && !input.exists) {
    throw new Error(`Extension package does not exist: ${input.packagePath}`)
  }
}

function installStagingRoot(rootPath: string) {
  return path.join(path.dirname(rootPath), EXTENSION_INSTALL_STAGING_DIR)
}

function installStagingPath(input: {
  readonly stagingRoot: string
  readonly extensionId: string
  readonly label: string
}) {
  return path.join(input.stagingRoot, `${input.extensionId}-${randomUUID()}-${input.label}`)
}

async function writePackageFiles(
  stagingPath: string,
  files: readonly NormalizedPackageFileWrite[],
) {
  const resolvedStagingPath = path.resolve(stagingPath)
  for (const file of files) {
    const filePath = path.resolve(resolvedStagingPath, file.normalizedRelativePath)
    if (!isPathInside(resolvedStagingPath, filePath)) {
      throw new Error(`Extension package file path escapes staging root: ${file.relativePath}`)
    }
    await mkdir(path.dirname(filePath), { recursive: true })
    await writeFile(filePath, file.content, 'utf-8')
  }
}

async function restoreBackup(input: { readonly packagePath: string; readonly backupPath: string }) {
  if (await pathExists(input.backupPath)) {
    await rm(input.packagePath, { recursive: true, force: true })
    await rename(input.backupPath, input.packagePath)
  }
}

async function replacePackageDirectory(input: {
  readonly mode: ExtensionPackageWriteMode
  readonly extensionId: string
  readonly rootPath: string
  readonly packagePath: string
  readonly files: readonly NormalizedPackageFileWrite[]
}) {
  await mkdir(input.rootPath, { recursive: true })
  const exists = await pathExists(input.packagePath)
  assertWriteMode({ mode: input.mode, packagePath: input.packagePath, exists })

  const stagingRoot = installStagingRoot(input.rootPath)
  await mkdir(stagingRoot, { recursive: true })
  const stagingPath = installStagingPath({
    stagingRoot,
    extensionId: input.extensionId,
    label: input.mode,
  })
  const backupPath = installStagingPath({
    stagingRoot,
    extensionId: input.extensionId,
    label: EXTENSION_INSTALL_BACKUP_SUFFIX,
  })

  try {
    await writePackageFiles(stagingPath, input.files)
    if (input.mode === 'create') {
      await rename(stagingPath, input.packagePath)
      return
    }

    await rename(input.packagePath, backupPath)
    try {
      await rename(stagingPath, input.packagePath)
      await rm(backupPath, { recursive: true, force: true })
    } catch (error) {
      await restoreBackup({ packagePath: input.packagePath, backupPath })
      throw error
    }
  } finally {
    await rm(stagingPath, { recursive: true, force: true })
  }
}

export async function writeFilesystemExtensionPackage(
  input: FilesystemWriteExtensionPackageInput,
): Promise<WriteExtensionPackageResult> {
  const paths = extensionPackagePath(input)
  const files = normalizePackageFiles(input.files)
  validatePackageManifestIdentity({ extensionId: input.extensionId, files })
  await replacePackageDirectory({
    mode: input.mode,
    extensionId: input.extensionId,
    rootPath: paths.rootPath,
    packagePath: paths.packagePath,
    files,
  })

  return {
    packagePath: paths.packagePath,
    manifestPath: paths.manifestPath,
    mode: input.mode,
  }
}

export async function removeFilesystemExtensionPackage(
  input: FilesystemRemoveExtensionPackageInput,
): Promise<RemoveExtensionPackageResult> {
  const paths = extensionPackagePath(input)
  try {
    await rm(paths.packagePath, { recursive: true })
    return { packagePath: paths.packagePath, removed: true }
  } catch (error) {
    if (isEnoent(error)) {
      return { packagePath: paths.packagePath, removed: false }
    }
    throw error
  }
}

export function getFilesystemExtensionPackagePath(input: {
  readonly extensionId: string
  readonly scope: ExtensionPackageScope
  readonly globalRootPath: string
}) {
  return extensionPackagePath(input)
}
