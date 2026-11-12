import fs from 'node:fs/promises'
import path from 'node:path'
import { decodeUnknownOrThrow } from '@shared/schema'
import type { SyntaxImportFormat, SyntaxResourceScope } from '@shared/types/syntax-resources'
import JSZip from 'jszip'
import { normalizedLanguage } from './syntax-language-normalization'
import {
  ARCHIVE_ENTRY_LIMIT,
  ARCHIVE_EXPANDED_LIMIT_BYTES,
  appearanceVariantFromUiTheme,
  chargeSyntaxReadBudget,
  confinedExtensionPath,
  createThemeIncludeBudget,
  emptySyntaxCatalog,
  parseJsonText,
  parseTextMatePlist,
  readBoundedFile,
  resolveThemeDeclaration,
  SYNTAX_IMPORT_RESOURCE_KIND_LIMIT,
  type SyntaxReadBudget,
  safeArchivePath,
  type ThemeIncludeBudget,
  toJsonObject,
} from './syntax-resource-import-utils'
import {
  decodeSource,
  extensionManifestSourceSchema,
  grammarDeclarationSourceSchema,
  hasResourcePath,
  isSourceObject,
  languageDeclarationSourceSchema,
  themeContributionSchema,
} from './syntax-source-schemas'
import { normalizedTheme } from './syntax-theme-normalization'

interface ExtensionResourceReader {
  readonly format: Extract<SyntaxImportFormat, 'vscode-extension' | 'vscode-vsix'>
  readonly resolveDeclared: (declaredPath: string) => string
  readonly resolveInclude: (resourcePath: string, includePath: string) => string
  readonly readText: (resourcePath: string, budget?: ThemeIncludeBudget) => Promise<string>
  readonly sourcePath: (resourcePath: string) => string
}

interface ExtensionManifest {
  readonly themes: readonly unknown[]
  readonly grammars: readonly unknown[]
  readonly languages: readonly unknown[]
  readonly packageId: string
}

const UNPACKED_EXTENSION_IMPORT_CONCURRENCY = 4

interface ArchiveExpansionBudget {
  expandedBytes: number
}

function canDestroyStream(
  stream: NodeJS.ReadableStream,
): stream is NodeJS.ReadableStream & { destroy: (error?: Error) => void } {
  return 'destroy' in stream && typeof stream.destroy === 'function'
}

function readBoundedArchiveText(
  entry: JSZip.JSZipObject,
  budget: ArchiveExpansionBudget,
  readBudget?: SyntaxReadBudget,
) {
  return new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = []
    const stream = entry.nodeStream('nodebuffer')
    stream.on('data', (chunk: Buffer) => {
      try {
        if (readBudget) chargeSyntaxReadBudget(readBudget, chunk.byteLength)
      } catch (error) {
        if (canDestroyStream(stream)) {
          stream.destroy(error instanceof Error ? error : new Error(String(error)))
        } else {
          stream.pause()
          reject(error)
        }
        return
      }
      budget.expandedBytes += chunk.byteLength
      if (budget.expandedBytes > ARCHIVE_EXPANDED_LIMIT_BYTES) {
        const error = new Error('Expanded syntax archive exceeds the size limit.')
        if (canDestroyStream(stream)) stream.destroy(error)
        else {
          stream.pause()
          reject(error)
        }
        return
      }
      chunks.push(chunk)
    })
    stream.once('error', reject)
    stream.once('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
  })
}

async function mapExtensionResources<Input, Output>(
  inputs: readonly Input[],
  concurrency: number,
  operation: (input: Input) => Promise<Output>,
) {
  const results: Output[] = []
  function runChain(index: number): Promise<void> {
    const input = inputs[index]
    if (input === undefined) return Promise.resolve()
    return operation(input)
      .then((result) => {
        results[index] = result
      })
      .then(() => runChain(index + concurrency))
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, inputs.length) }, (_, index) => runChain(index)),
  )
  return results
}

function extensionManifest(raw: unknown, fallbackName: string) {
  const manifest = decodeSource(extensionManifestSourceSchema, raw)
  const contributes = manifest?.contributes
  if (!contributes) throw new Error('VS Code extension does not declare contributions.')
  const publisher = manifest.publisher ?? 'local'
  const packageName = manifest.name ?? fallbackName
  return {
    themes: contributes.themes ?? [],
    grammars: contributes.grammars ?? [],
    languages: contributes.languages ?? [],
    packageId: `${publisher}.${packageName}`,
  }
}

async function importExtensionThemes(
  manifest: ExtensionManifest,
  reader: ExtensionResourceReader,
  scope: SyntaxResourceScope,
) {
  const declarations = manifest.themes.flatMap(
    (candidate) => decodeSource(themeContributionSchema, candidate) ?? [],
  )
  const concurrency = reader.format === 'vscode-vsix' ? 1 : UNPACKED_EXTENSION_IMPORT_CONCURRENCY
  return mapExtensionResources(declarations, concurrency, async (declaration) => {
    const resourcePath = reader.resolveDeclared(declaration.path)
    const includeBudget =
      reader.format === 'vscode-extension' ? createThemeIncludeBudget() : undefined
    const resolved = await resolveThemeDeclaration(
      resourcePath,
      async (candidate) =>
        parseJsonText(await reader.readText(candidate, includeBudget), includeBudget),
      reader.resolveInclude,
    )
    const label = declaration.label ?? path.basename(resourcePath, path.extname(resourcePath))
    const forcedVariant = appearanceVariantFromUiTheme(declaration.uiTheme)
    return normalizedTheme({
      raw: resolved.raw,
      originalRaw: resolved.original,
      label,
      packageId: manifest.packageId,
      declaredIdentity: declaration.id ?? safeArchivePath(declaration.path),
      format: reader.format,
      sourcePath: reader.sourcePath(resourcePath),
      scope,
      ...(forcedVariant ? { forcedVariant } : {}),
    })
  })
}

async function importExtensionGrammars(
  manifest: ExtensionManifest,
  reader: ExtensionResourceReader,
  scope: SyntaxResourceScope,
) {
  const languageDeclarations = manifest.languages.filter(isSourceObject).map((candidate) => {
    const raw = toJsonObject(candidate)
    return { raw, source: decodeUnknownOrThrow(languageDeclarationSourceSchema, raw) }
  })
  const concurrency = reader.format === 'vscode-vsix' ? 1 : UNPACKED_EXTENSION_IMPORT_CONCURRENCY
  return mapExtensionResources(
    manifest.grammars.filter(hasResourcePath),
    concurrency,
    async (declaration) => {
      const resourcePath = reader.resolveDeclared(declaration.path)
      const rawDeclaration = toJsonObject(declaration)
      const source = await reader.readText(resourcePath)
      const grammar = resourcePath.toLowerCase().endsWith('.json')
        ? parseJsonText(source)
        : parseTextMatePlist(source)
      const languageId = decodeUnknownOrThrow(
        grammarDeclarationSourceSchema,
        rawDeclaration,
      ).language
      const language = languageDeclarations.find(
        (candidate) => languageId !== undefined && candidate.source.id === languageId,
      )
      const configurationPath = language?.source.configuration
      const configuration =
        configurationPath === undefined
          ? undefined
          : parseJsonText(await reader.readText(reader.resolveDeclared(configurationPath)))
      return normalizedLanguage({
        grammar,
        declaration: rawDeclaration,
        language: language?.raw,
        packageId: manifest.packageId,
        format: reader.format,
        sourcePath: reader.sourcePath(resourcePath),
        scope,
        configuration,
      })
    },
  )
}

async function importExtensionResources(
  manifest: ExtensionManifest,
  reader: ExtensionResourceReader,
  scope: SyntaxResourceScope,
) {
  if (
    manifest.themes.length > SYNTAX_IMPORT_RESOURCE_KIND_LIMIT ||
    manifest.grammars.length > SYNTAX_IMPORT_RESOURCE_KIND_LIMIT
  ) {
    throw new Error('A VS Code syntax extension declares too many resources of one kind.')
  }
  const catalog = emptySyntaxCatalog()
  catalog.themes.push(...(await importExtensionThemes(manifest, reader, scope)))
  catalog.languages.push(...(await importExtensionGrammars(manifest, reader, scope)))
  if (catalog.themes.length === 0 && catalog.languages.length === 0) {
    throw new Error('VS Code extension does not declare themes or TextMate grammars.')
  }
  return catalog
}

export async function parseUnpackedSyntaxExtension(
  directory: string,
  scope: SyntaxResourceScope,
  readBudget?: SyntaxReadBudget,
) {
  const packageRoot = await fs.realpath(directory)
  const readConfinedText = async (resourcePath: string, budget?: ThemeIncludeBudget) => {
    const realResourcePath = await fs.realpath(resourcePath)
    const relative = path.relative(packageRoot, realResourcePath)
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new Error('Syntax extension resource symlink leaves its package.')
    }
    return (await readBoundedFile(realResourcePath, budget, readBudget)).toString('utf8')
  }
  const manifestPath = path.join(packageRoot, 'package.json')
  const manifest = extensionManifest(
    parseJsonText(
      (
        await readBoundedFile(manifestPath, undefined, readBudget, {
          followSymbolicLink: false,
        })
      ).toString('utf8'),
    ),
    path.basename(packageRoot),
  )
  const reader: ExtensionResourceReader = {
    format: 'vscode-extension',
    resolveDeclared: (declaredPath) => confinedExtensionPath(packageRoot, declaredPath),
    resolveInclude: (resourcePath, includePath) =>
      confinedExtensionPath(packageRoot, path.resolve(path.dirname(resourcePath), includePath)),
    readText: readConfinedText,
    sourcePath: (resourcePath) => resourcePath,
  }
  return importExtensionResources(manifest, reader, scope)
}

export async function parseVsixSyntaxExtension(
  filePath: string,
  scope: SyntaxResourceScope,
  readBudget?: SyntaxReadBudget,
) {
  const archive = await JSZip.loadAsync(await readBoundedFile(filePath, undefined, readBudget))
  const entries = Object.values(archive.files)
  if (entries.length > ARCHIVE_ENTRY_LIMIT) {
    throw new Error('Theme archive contains too many files.')
  }
  const packageEntry = entries.find(
    (entry) => safeArchivePath(entry.name) === 'extension/package.json',
  )
  if (!packageEntry) throw new Error('VSIX does not contain extension/package.json.')
  const expansionBudget: ArchiveExpansionBudget = { expandedBytes: 0 }
  const manifest = extensionManifest(
    parseJsonText(await readBoundedArchiveText(packageEntry, expansionBudget, readBudget)),
    path.basename(filePath),
  )
  const reader: ExtensionResourceReader = {
    format: 'vscode-vsix',
    resolveDeclared: (declaredPath) =>
      safeArchivePath(`extension/${safeArchivePath(declaredPath)}`),
    resolveInclude: (resourcePath, includePath) =>
      safeArchivePath(path.posix.join(path.posix.dirname(resourcePath), includePath)),
    readText: async (resourcePath) => {
      const safePath = safeArchivePath(resourcePath)
      if (!safePath.startsWith('extension/')) {
        throw new Error('VS Code syntax resource escapes the extension package.')
      }
      const entry = archive.file(safePath)
      if (!entry) throw new Error(`VSIX syntax resource is missing: ${safePath}`)
      return readBoundedArchiveText(entry, expansionBudget, readBudget)
    },
    sourcePath: (resourcePath) => `${filePath}#${resourcePath}`,
  }
  return importExtensionResources(manifest, reader, scope)
}
