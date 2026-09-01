import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import type {
  SyntaxResourceCatalog,
  SyntaxThemeImportPreview,
} from '@shared/types/syntax-resources'
import { SYNTAX_IMPORT_RESOURCE_KIND_LIMIT } from './syntax-resource-import-utils'
import {
  INSTALLED_RESOURCE_CATALOG_MAX_BYTES,
  INSTALLED_RESOURCE_FILE_LIMIT,
  isSyntaxAppearanceResource,
  isSyntaxLanguageResource,
  isSyntaxThemeResource,
  readPersistedResources,
} from './syntax-resource-persistence-read'
import {
  mergeSyntaxResourceCatalogs,
  readProjectSyntaxCatalog,
  type SyntaxSourceParser,
} from './syntax-resource-project-catalog'

const JSON_INDENT_SPACES = 2
const INSTALLED_RESOURCE_KINDS = ['themes', 'languages', 'appearances'] as const

const resourceDirectoryTails = new Map<string, Promise<void>>()

async function withSyntaxResourceDirectoryLock<T>(
  resourcesDirectory: string,
  operation: () => Promise<T>,
) {
  const lockKey = path.resolve(resourcesDirectory)
  const previous = resourceDirectoryTails.get(lockKey) ?? Promise.resolve()
  const result = previous.then(operation, operation)
  const settled = result.then(
    () => undefined,
    () => undefined,
  )
  resourceDirectoryTails.set(lockKey, settled)
  try {
    return await result
  } finally {
    if (resourceDirectoryTails.get(lockKey) === settled) {
      resourceDirectoryTails.delete(lockKey)
    }
  }
}

function resourceFileName(resourceId: string) {
  return `${createHash('sha256').update(resourceId).digest('hex')}.json`
}

async function assertInstalledResourceCapacity(directory: string, resourceIds: readonly string[]) {
  const installedNames = (await fs.readdir(directory)).filter((entry) => entry.endsWith('.json'))
  const resultingNames = new Set(installedNames)
  for (const resourceId of resourceIds) resultingNames.add(resourceFileName(resourceId))
  if (resultingNames.size > INSTALLED_RESOURCE_FILE_LIMIT) {
    throw new Error('Installing this import would exceed the syntax resource library limit.')
  }
}

async function assertStagedInstalledResourceCatalogByteCapacity(stagingDirectory: string) {
  const byteTotals = await Promise.all(
    INSTALLED_RESOURCE_KINDS.map(async (kind) => {
      const directory = path.join(stagingDirectory, kind)
      const names = (await fs.readdir(directory)).filter((entry) => entry.endsWith('.json'))
      const sizes = await Promise.all(names.map((name) => fs.stat(path.join(directory, name))))
      return sizes.reduce((total, stats) => total + stats.size, 0)
    }),
  )
  const serializedBytes = byteTotals.reduce((total, kindTotal) => total + kindTotal, 0)
  if (serializedBytes > INSTALLED_RESOURCE_CATALOG_MAX_BYTES) {
    throw new Error('Installing this import would exceed the syntax resource aggregate byte limit.')
  }
}

async function readInstalledResourceCatalog(resourcesDirectory: string) {
  const budget = { remainingBytes: INSTALLED_RESOURCE_CATALOG_MAX_BYTES }
  const themes = await readPersistedResources(
    path.join(resourcesDirectory, 'themes'),
    isSyntaxThemeResource,
    budget,
  )
  const languages = await readPersistedResources(
    path.join(resourcesDirectory, 'languages'),
    isSyntaxLanguageResource,
    budget,
  )
  const appearances = await readPersistedResources(
    path.join(resourcesDirectory, 'appearances'),
    isSyntaxAppearanceResource,
    budget,
  )
  return { themes, languages, appearances } satisfies SyntaxResourceCatalog
}

export async function applySyntaxThemePreview(
  resourcesDirectory: string,
  preview: SyntaxThemeImportPreview,
) {
  return withSyntaxResourceDirectoryLock(resourcesDirectory, () =>
    applySyntaxThemePreviewLocked(resourcesDirectory, preview),
  )
}

async function applySyntaxThemePreviewLocked(
  resourcesDirectory: string,
  preview: SyntaxThemeImportPreview,
) {
  for (const resources of [preview.themes, preview.languages, preview.appearances]) {
    if (resources.length > SYNTAX_IMPORT_RESOURCE_KIND_LIMIT) {
      throw new Error('A syntax import contains too many resources of one kind.')
    }
    const identities = new Set<string>()
    for (const resource of resources) {
      if (identities.has(resource.id)) {
        throw new Error(`A syntax import declares the identity more than once: ${resource.id}`)
      }
      identities.add(resource.id)
    }
  }
  const transactionId = randomUUID()
  const parentDirectory = path.dirname(resourcesDirectory)
  const stagingDirectory = `${resourcesDirectory}.staging-${transactionId}`
  const backupDirectory = `${resourcesDirectory}.backup-${transactionId}`
  let originalMoved = false
  let retainBackup = false
  await fs.mkdir(parentDirectory, { recursive: true })
  try {
    await fs
      .cp(resourcesDirectory, stagingDirectory, {
        recursive: true,
        errorOnExist: true,
        force: false,
      })
      .catch((error: unknown) => {
        const code = error instanceof Error && 'code' in error ? error.code : null
        if (code !== 'ENOENT') throw error
      })
    await fs.mkdir(stagingDirectory, { recursive: true })
    await Promise.all(
      (
        [
          ['themes', preview.themes],
          ['languages', preview.languages],
          ['appearances', preview.appearances],
        ] as const
      ).map(async ([kind, resources]) => {
        const directory = path.join(stagingDirectory, kind)
        await fs.mkdir(directory, { recursive: true })
        await assertInstalledResourceCapacity(
          directory,
          resources.map((resource) => resource.id),
        )
        await Promise.all(
          resources.map((resource) =>
            fs.writeFile(
              path.join(directory, resourceFileName(resource.id)),
              `${JSON.stringify(resource, null, JSON_INDENT_SPACES)}\n`,
              { flag: 'w' },
            ),
          ),
        )
      }),
    )
    await assertStagedInstalledResourceCatalogByteCapacity(stagingDirectory)
    await fs.rename(resourcesDirectory, backupDirectory).then(
      () => {
        originalMoved = true
      },
      (error: unknown) => {
        const code = error instanceof Error && 'code' in error ? error.code : null
        if (code !== 'ENOENT') throw error
      },
    )
    await fs.rename(stagingDirectory, resourcesDirectory)
    originalMoved = false
    await fs.rm(backupDirectory, { recursive: true, force: true })
  } catch (error) {
    if (originalMoved) {
      try {
        await fs.rename(backupDirectory, resourcesDirectory)
        originalMoved = false
      } catch (rollbackError) {
        retainBackup = true
        throw new Error(
          `Syntax resource installation failed (${error instanceof Error ? error.message : String(error)}) and automatic rollback also failed. The previous library was retained at ${backupDirectory}`,
          { cause: rollbackError },
        )
      }
    }
    throw error
  } finally {
    if (retainBackup) {
      // Preserve the recovery error and its retained backup even if staging cleanup also fails.
      await fs.rm(stagingDirectory, { recursive: true, force: true }).catch(() => undefined)
    } else {
      await Promise.all([
        fs.rm(stagingDirectory, { recursive: true, force: true }),
        fs.rm(backupDirectory, { recursive: true, force: true }),
      ])
    }
  }
}

export async function listInstalledSyntaxResources(
  resourcesDirectory: string,
  projectPath: string | null | undefined,
  parseSource: SyntaxSourceParser,
): Promise<SyntaxResourceCatalog> {
  const globalResources = await withSyntaxResourceDirectoryLock(resourcesDirectory, () =>
    readInstalledResourceCatalog(resourcesDirectory),
  )
  if (!projectPath) return globalResources
  return mergeSyntaxResourceCatalogs(
    globalResources,
    await readProjectSyntaxCatalog(projectPath, parseSource),
  )
}

export async function removeInstalledSyntaxTheme(resourcesDirectory: string, resourceId: string) {
  return withSyntaxResourceDirectoryLock(resourcesDirectory, () =>
    removeInstalledSyntaxThemeLocked(resourcesDirectory, resourceId),
  )
}

async function removeInstalledSyntaxThemeLocked(resourcesDirectory: string, resourceId: string) {
  const { themes, languages, appearances } = await readInstalledResourceCatalog(resourcesDirectory)
  const theme = themes.find((resource) => resource.id === resourceId)
  const language = languages.find((resource) => resource.id === resourceId)
  const appearance = appearances.find((resource) => resource.id === resourceId)
  const target = theme ?? language ?? appearance
  if (target?.scope !== 'user') {
    throw new Error('Only user-imported syntax resources can be removed.')
  }
  const kind = theme ? 'themes' : language ? 'languages' : 'appearances'
  await fs.rm(path.join(resourcesDirectory, kind, resourceFileName(target.id)))
}
