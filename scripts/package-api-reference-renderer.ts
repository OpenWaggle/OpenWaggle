import { createHash } from 'node:crypto'
import path from 'node:path'
import { Schema } from '@shared/schema'
import { objectFields, unknownField } from './support/object-fields'

/*
 * The marker names the package version whose declarations the page lists and the SHA-256 of the
 * page without the marker. A published version's page is frozen: it is generated again only once
 * the package's version changes, at a release, and until then the hash shows it was not edited.
 */
const GENERATED_API_MARKER_PATTERN =
  /^<!-- Generated from the public declarations of (?<packageName>\S+) (?<packageVersion>\S+)(?:; content sha256 (?<contentHash>[0-9a-f]{64}))?\. -->$/mu
const MATCH_DECLARATION_GROUP = 2
const NAMED_EXPORT_SOURCE_GROUP = 2
const SUBPATH_PREFIX_LENGTH = 2

interface ApiSymbol {
  readonly kind: string
  readonly name: string
}

interface RenderApiReferenceInput {
  readonly apiDescription: string
  readonly exports: Readonly<Record<string, unknown>>
  readonly packageName: string
  /** The package.json version, which the generated marker records. */
  readonly packageVersion: string
  readonly snapshot: string
  readonly version: string
}

/** The package version a generated API page lists, or `undefined` for a page without the marker. */
export function generatedApiReferencePackageVersion(contents: string) {
  return GENERATED_API_MARKER_PATTERN.exec(contents)?.groups?.packageVersion
}

function apiReferenceContentHash(contents: string) {
  return createHash('sha256')
    .update(contents.replace(GENERATED_API_MARKER_PATTERN, ''))
    .digest('hex')
}

/** Whether a generated API page still holds the content whose hash its marker records. */
export function apiReferenceMatchesRecordedHash(contents: string) {
  const recorded = GENERATED_API_MARKER_PATTERN.exec(contents)?.groups?.contentHash
  return recorded !== undefined && recorded === apiReferenceContentHash(contents)
}

function normalizeMarkdown(value: string) {
  return `${value.replaceAll('\r\n', '\n').trimEnd()}\n`
}

function declarationSections(snapshot: string) {
  const sections = new Map<string, string>()
  const sectionPattern = /### Declarations from `([^`]+)`\n\n```ts\n([\s\S]*?)\n```/gu
  for (const match of snapshot.matchAll(sectionPattern)) {
    const filePath = match[1]
    const declaration = match[MATCH_DECLARATION_GROUP]
    if (filePath && declaration) sections.set(filePath, declaration)
  }
  return sections
}

const typedTargetSchema = Schema.Struct({ types: unknownField })

function exportTypesPath(target: unknown) {
  const types = objectFields(typedTargetSchema, target)?.types
  return typeof types === 'string' ? types : undefined
}

function directExportedSymbols(declaration: string) {
  const symbols = new Map<string, ApiSymbol>()
  const declarationPattern =
    /^export\s+(?:declare\s+)?(interface|type|function|class|const|let|var|enum|namespace)\s+([A-Za-z_$][\w$]*)/gmu
  for (const match of declaration.matchAll(declarationPattern)) {
    const kind = match[1]
    const name = match[MATCH_DECLARATION_GROUP]
    if (kind && name) symbols.set(name, { kind, name })
  }

  if (/^export\s+default(?:\s+declare)?\s+/mu.test(declaration)) {
    symbols.set('default', { kind: 'default export', name: 'default' })
  }
  return symbols
}

function declarationPathFromSpecifier(sourcePath: string, specifier: string) {
  if (!specifier.startsWith('.')) return undefined
  const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(sourcePath), specifier))
  if (resolved.endsWith('.js')) return `${resolved.slice(0, -'.js'.length)}.d.ts`
  if (resolved.endsWith('.mjs')) return `${resolved.slice(0, -'.mjs'.length)}.d.mts`
  if (resolved.endsWith('.cjs')) return `${resolved.slice(0, -'.cjs'.length)}.d.cts`
  return resolved
}

function namedExportParts(rawExport: string) {
  const normalized = rawExport.trim().replace(/^type\s+/u, '')
  const [importedName, exportedName = importedName] = normalized.split(/\s+as\s+/u)
  if (
    importedName === undefined ||
    exportedName === undefined ||
    !/^[A-Za-z_$][\w$]*$/u.test(importedName) ||
    !/^[A-Za-z_$][\w$]*$/u.test(exportedName)
  ) {
    return undefined
  }
  return { exportedName, importedName }
}

function mergeStarExports(
  symbols: Map<string, ApiSymbol>,
  sections: ReadonlyMap<string, string>,
  declarationPath: string,
  declaration: string,
  visiting: ReadonlySet<string>,
) {
  const starExportPattern = /^export\s+(?:type\s+)?\*\s+from\s+['"]([^'"]+)['"]\s*;/gmu
  for (const match of declaration.matchAll(starExportPattern)) {
    const specifier = match[1]
    const targetPath = specifier
      ? declarationPathFromSpecifier(declarationPath, specifier)
      : undefined
    if (targetPath === undefined) continue
    for (const symbol of exportedSymbols(sections, targetPath, visiting)) {
      if (symbol.name !== 'default') symbols.set(symbol.name, symbol)
    }
  }
}

function mergeNamedExports(
  symbols: Map<string, ApiSymbol>,
  sections: ReadonlyMap<string, string>,
  declarationPath: string,
  declaration: string,
  visiting: ReadonlySet<string>,
) {
  const namedExportPattern =
    /^export\s+(?:type\s+)?\{([\s\S]*?)\}\s*(?:from\s+['"]([^'"]+)['"])?\s*;/gmu
  for (const match of declaration.matchAll(namedExportPattern)) {
    const specifier = match[NAMED_EXPORT_SOURCE_GROUP]
    const targetPath = specifier
      ? declarationPathFromSpecifier(declarationPath, specifier)
      : undefined
    const targetSymbols =
      specifier === undefined
        ? [...symbols.values()]
        : targetPath
          ? exportedSymbols(sections, targetPath, visiting)
          : []
    for (const rawExport of match[1]?.split(',') ?? []) {
      const parts = namedExportParts(rawExport)
      if (parts === undefined) continue
      const targetSymbol = targetSymbols.find((candidate) => candidate.name === parts.importedName)
      symbols.set(parts.exportedName, {
        kind: targetSymbol?.kind ?? 're-export',
        name: parts.exportedName,
      })
    }
  }
}

function exportedSymbols(
  sections: ReadonlyMap<string, string>,
  declarationPath: string,
  visiting: ReadonlySet<string> = new Set(),
) {
  if (visiting.has(declarationPath)) return [] satisfies readonly ApiSymbol[]
  const declaration = sections.get(declarationPath)
  if (declaration === undefined) {
    throw new Error(`Missing ${declarationPath} in the package API snapshot.`)
  }

  const nextVisiting = new Set(visiting)
  nextVisiting.add(declarationPath)
  const symbols = directExportedSymbols(declaration)
  mergeStarExports(symbols, sections, declarationPath, declaration, nextVisiting)
  mergeNamedExports(symbols, sections, declarationPath, declaration, nextVisiting)

  return [...symbols.values()].sort((left, right) =>
    left.name.localeCompare(right.name),
  ) satisfies readonly ApiSymbol[]
}

const PACKAGE_MODULE_DESCRIPTIONS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  '@openwaggle/extension-sdk': {
    '.': 'Convenience entry point that re-exports the complete browser-safe extension author contract.',
    './agent-loop':
      'Typed DTOs and schemas for tool, interaction, transcript, custom-message, and run-status surfaces.',
    './broker': 'Capability-broker request, response, scope, audit, and SDK helpers.',
    './constants': 'Stable extension and broker protocol constants.',
    './context': 'Federated-module mount context, surface SDK, and shared-module helpers.',
    './docs': 'Installed documentation discovery and topic contracts.',
    './json': 'JSON-safe value types and runtime schemas.',
    './manifest': 'Extension manifest schemas, contribution declarations, and validation helpers.',
    './runtime': 'Runtime contribution registration contracts and SDK helpers.',
    './theme': 'Host-provided theme tokens and CSS variable helpers.',
    './types': 'Shared extension package, contribution, and registry contracts.',
    './ui': 'Framework-neutral class names, attributes, and stylesheet generation.',
  },
  '@openwaggle/extension-react': {
    '.': 'React components and props for host-aligned extension surfaces.',
    './styles.css': 'Default host-aligned stylesheet for the React components.',
  },
  '@openwaggle/waggle-core': {
    '.': 'Convenience entry point for the complete runtime-neutral Waggle policy API.',
    './config': 'Configuration, validation, model, agent, and safety-limit contracts.',
    './consensus': 'Consensus signals and convergence evaluation.',
    './events': 'Runtime-neutral collaboration event metadata.',
    './presets': 'Built-in preset definitions and preset composition.',
    './prompts': 'Prompt builders for collaborative turns.',
    './state': 'Serializable Waggle state helpers.',
    './turn-policy': 'Turn ownership, continuation, and stopping decisions.',
  },
  '@openwaggle/pi-waggle': {
    '.': 'Convenience entry point for Pi-native Waggle integration.',
    './commands': 'Pi command parsing and intent contracts.',
    './extension': 'Default Pi extension entry point and advanced loop exports.',
    './loop': 'Composable Pi agent-loop hooks and controllers.',
    './mode-state': 'Pi session-backed Waggle mode state.',
    './preset-storage': 'Pi-backed custom preset persistence.',
    './presets': 'Pi preset selection and resolution.',
    './protocol': 'Pi custom-message names, schemas, and parsing helpers.',
    './renderers': 'Pi-native Waggle transcript renderers.',
    './stop-policy': 'Pi stop-policy integration.',
  },
}

function moduleDescription(packageName: string, subpath: string) {
  return (
    PACKAGE_MODULE_DESCRIPTIONS[packageName]?.[subpath] ??
    `Public API for the \`${subpath}\` package export.`
  )
}

function renderModule(
  input: RenderApiReferenceInput,
  sections: ReadonlyMap<string, string>,
  subpath: string,
  target: unknown,
) {
  const typesPath = exportTypesPath(target)
  const symbols =
    typesPath === undefined ? [] : exportedSymbols(sections, typesPath.replace(/^\.\//u, ''))
  const importPath =
    subpath === '.'
      ? input.packageName
      : `${input.packageName}/${subpath.slice(SUBPATH_PREFIX_LENGTH)}`
  const lines = [`## \`${importPath}\``, '', moduleDescription(input.packageName, subpath), '']
  if (symbols.length === 0) {
    lines.push('This export contains styles or re-exports the typed modules listed below.', '')
    return lines.join('\n')
  }
  lines.push('| Export | Kind |', '|--------|------|')
  for (const symbol of symbols) lines.push(`| \`${symbol.name}\` | ${symbol.kind} |`)
  lines.push('')
  return lines.join('\n')
}

export function renderApiReference(input: RenderApiReferenceInput) {
  const sections = declarationSections(input.snapshot)
  const moduleSections = Object.entries(input.exports).map(([subpath, target]) =>
    renderModule(input, sections, subpath, target),
  )
  const marker = `<!-- Generated from the public declarations of ${input.packageName} ${input.packageVersion}`
  const page = normalizeMarkdown(
    [
      '---',
      `title: "${input.packageName} API"`,
      `description: "Complete public API reference for ${input.packageName} ${input.version}."`,
      'order: 90',
      'section: "Packages"',
      'kind: "reference"',
      '---',
      '',
      `${marker}. -->`,
      '',
      `This reference inventories every public entry point and named export in \`${input.packageName}\` ${input.version}.`,
      '',
      input.apiDescription,
      '',
      ...moduleSections,
    ].join('\n'),
  )
  return page.replace(
    `${marker}. -->`,
    `${marker}; content sha256 ${apiReferenceContentHash(page)}. -->`,
  )
}
