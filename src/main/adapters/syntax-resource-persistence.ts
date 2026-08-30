import { createHash, randomUUID } from 'node:crypto'
import type { Dirent } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import type {
  SyntaxResourceCatalog,
  SyntaxResourceScope,
  SyntaxThemeImportPreview,
} from '@shared/types/syntax-resources'
import { emptySyntaxCatalog } from './syntax-resource-import-utils'
import {
  isSyntaxAppearanceResource,
  isSyntaxLanguageResource,
  isSyntaxThemeResource,
  readPersistedResources,
} from './syntax-resource-persistence-read'

const PROJECT_RESOURCE_FILE_LIMIT = 20
const PROJECT_RESOURCE_PARSE_CONCURRENCY = 4
const PROJECT_CATALOG_MAX_BYTES = 8 * 1024 * 1024
const PROJECT_CATALOG_MAX_RESOURCES = 200
const JSON_INDENT_SPACES = 2

type SyntaxSourceParser = (
  filePath: string,
  scope: SyntaxResourceScope,
) => Promise<SyntaxResourceCatalog>

function resourceFileName(resourceId: string) {
  return `${createHash('sha256').update(resourceId).digest('hex')}.json`
}

export async function applySyntaxThemePreview(
  resourcesDirectory: string,
  preview: SyntaxThemeImportPreview,
) {
  for (const resources of [preview.themes, preview.languages, preview.appearances]) {
    if (resources.length > PROJECT_RESOURCE_FILE_LIMIT) {
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
      await fs.rename(backupDirectory, resourcesDirectory).catch(() => undefined)
    }
    throw error
  } finally {
    await Promise.all([
      fs.rm(stagingDirectory, { recursive: true, force: true }),
      fs.rm(backupDirectory, { recursive: true, force: true }),
    ])
  }
}

async function parseProjectResources(
  resourcePaths: readonly string[],
  parseSource: SyntaxSourceParser,
): Promise<readonly SyntaxResourceCatalog[]> {
  const parsedByIndex = new Map<number, SyntaxResourceCatalog>()
  let catalogBytes = 0
  let resourceCount = 0
  function parseChain(index: number): Promise<void> {
    const resourcePath = resourcePaths[index]
    if (!resourcePath) return Promise.resolve()
    return parseSource(resourcePath, 'project')
      .then((parsed) => {
        const nextResourceCount =
          parsed.themes.length + parsed.languages.length + parsed.appearances.length
        const nextBytes = Buffer.byteLength(JSON.stringify(parsed), 'utf8')
        if (
          resourceCount + nextResourceCount > PROJECT_CATALOG_MAX_RESOURCES ||
          catalogBytes + nextBytes > PROJECT_CATALOG_MAX_BYTES
        ) {
          throw new Error('Project syntax resources exceed the aggregate catalog limit.')
        }
        resourceCount += nextResourceCount
        catalogBytes += nextBytes
        parsedByIndex.set(index, parsed)
      })
      .catch(() => {
        // A malformed project resource does not hide the remaining catalog.
      })
      .then(() => parseChain(index + PROJECT_RESOURCE_PARSE_CONCURRENCY))
  }
  await Promise.all(
    Array.from(
      { length: Math.min(PROJECT_RESOURCE_PARSE_CONCURRENCY, resourcePaths.length) },
      (_, index) => parseChain(index),
    ),
  )
  return [...parsedByIndex.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, parsed]) => parsed)
}

async function readProjectCatalog(projectPath: string, parseSource: SyntaxSourceParser) {
  const catalog = emptySyntaxCatalog()
  const projectRoot = await fs.realpath(projectPath)
  const roots = [
    path.join(projectRoot, '.openwaggle', 'themes'),
    path.join(projectRoot, '.openwaggle', 'languages'),
    path.join(projectRoot, '.openwaggle', 'syntax'),
  ]
  const entriesByRoot = await Promise.all(
    roots.map(async (root): Promise<readonly Dirent[]> => {
      try {
        const realRoot = await fs.realpath(root)
        if (realRoot !== path.resolve(root)) return []
        return (await fs.readdir(realRoot, { withFileTypes: true })).filter(
          (entry) => !entry.isSymbolicLink(),
        )
      } catch {
        return []
      }
    }),
  )
  const resourcePaths = entriesByRoot
    .flatMap((entries, rootIndex) =>
      entries.map((entry) => path.join(roots[rootIndex] ?? projectPath, entry.name)),
    )
    .slice(0, PROJECT_RESOURCE_FILE_LIMIT)
  for (const parsed of await parseProjectResources(resourcePaths, parseSource)) {
    catalog.themes.push(...parsed.themes)
    catalog.languages.push(...parsed.languages)
    catalog.appearances.push(...parsed.appearances)
  }
  return catalog
}

function mergedCatalog(global: SyntaxResourceCatalog, project: SyntaxResourceCatalog) {
  const themes = new Map(global.themes.map((resource) => [resource.id, resource]))
  const languages = new Map(global.languages.map((resource) => [resource.id, resource]))
  const appearances = new Map(global.appearances.map((resource) => [resource.id, resource]))
  for (const resource of project.themes) themes.set(resource.id, resource)
  for (const resource of project.languages) {
    if (!languages.has(resource.id)) languages.set(resource.id, resource)
  }
  for (const resource of project.appearances) appearances.set(resource.id, resource)
  return {
    themes: [...themes.values()],
    languages: [...languages.values()],
    appearances: [...appearances.values()],
  }
}

export async function listInstalledSyntaxResources(
  resourcesDirectory: string,
  projectPath: string | null | undefined,
  parseSource: SyntaxSourceParser,
): Promise<SyntaxResourceCatalog> {
  const [themes, languages, appearances] = await Promise.all([
    readPersistedResources(path.join(resourcesDirectory, 'themes'), isSyntaxThemeResource),
    readPersistedResources(path.join(resourcesDirectory, 'languages'), isSyntaxLanguageResource),
    readPersistedResources(
      path.join(resourcesDirectory, 'appearances'),
      isSyntaxAppearanceResource,
    ),
  ])
  const globalResources: SyntaxResourceCatalog = { themes, languages, appearances }
  if (!projectPath) return globalResources
  return mergedCatalog(globalResources, await readProjectCatalog(projectPath, parseSource))
}

export async function removeInstalledSyntaxTheme(resourcesDirectory: string, resourceId: string) {
  const [themes, languages, appearances] = await Promise.all([
    readPersistedResources(path.join(resourcesDirectory, 'themes'), isSyntaxThemeResource),
    readPersistedResources(path.join(resourcesDirectory, 'languages'), isSyntaxLanguageResource),
    readPersistedResources(
      path.join(resourcesDirectory, 'appearances'),
      isSyntaxAppearanceResource,
    ),
  ])
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
