/**
 * Writes `packages/extension-sdk/src/generated/*.ts`: the extension SDK's public types, printed
 * from its internal Effect schemas so the published declarations name no Effect type and a hover
 * shows each type's fields. Every `src/internal/type-sources/<module>.ts` lists public names as
 * `SchemaType<typeof schema>` aliases; this script prints each alias as a plain declaration in
 * `src/generated/<module>.ts`, naming a nested type when it is another public type. It also
 * writes `src/__tests__/generated-types.unit.test.ts`, which type-checks that every printed type
 * equals the schema type it came from.
 *
 * Usage: `bun run extension-sdk-types:generate` rewrites the files, and `--check` (the
 * `extension-sdk-types` step of `bun run check`) fails while one is out of date.
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Checker, Project, Type } from 'typescript/unstable/async'
import { API, SymbolFlags } from 'typescript/unstable/async'
import { createTypePrinter, type NamedType } from './extension-sdk-types-printer'

const PACKAGE_SOURCE = 'packages/extension-sdk/src'
const PROJECT_CONFIG = 'packages/extension-sdk/tsconfig.build.json'
const SOURCE_DIRECTORY = `${PACKAGE_SOURCE}/internal/type-sources`
const OUTPUT_DIRECTORY = `${PACKAGE_SOURCE}/generated`
const TYPE_TEST_PATH = `${PACKAGE_SOURCE}/__tests__/generated-types.unit.test.ts`
/** Hand-written public modules whose types the printer names instead of expanding. */
const NAMED_MODULES = [{ file: `${PACKAGE_SOURCE}/json.ts`, specifier: '../json.js' }]
const OXFMT_LAUNCHER = 'node_modules/oxfmt/bin/oxfmt'
const FORMATTER_OUTPUT_LIMIT_BYTES = 16_777_216

interface SourceType {
  readonly name: string
  readonly doc: string
  readonly type: Type
}

interface SourceModule {
  readonly module: string
  readonly types: readonly SourceType[]
}

async function exportedTypes(checker: Checker, project: Project, file: string) {
  const sourceFile = await project.program.getSourceFile(file)
  const moduleSymbol = sourceFile && (await checker.getSymbolAtLocation(sourceFile))
  if (moduleSymbol === undefined) throw new Error(`${file} is not in ${PROJECT_CONFIG}.`)
  const symbols = (await checker.getExportsOfModule(moduleSymbol)).filter(
    (symbol) => (symbol.flags & (SymbolFlags.TypeAlias | SymbolFlags.Interface)) !== 0,
  )
  const ordered = symbols.toSorted(
    (left, right) => (left.declarations[0]?.index ?? 0) - (right.declarations[0]?.index ?? 0),
  )
  return Promise.all(
    ordered.map(async (symbol) => ({
      name: symbol.name,
      doc: await checker.getDocumentationCommentOfSymbol(symbol),
      type: await checker.getDeclaredTypeOfSymbol(symbol),
    })),
  )
}

async function namedType(name: string, module: string, type: Type) {
  const base = { name, module, typeId: type.id }
  if (!type.isUnionType()) return { ...base, objectLike: type.isObjectType() }
  const members = await type.getTypes()
  if (!members.some((member) => member.isObjectType())) return { ...base, objectLike: false }
  return { ...base, objectLike: true, memberIds: new Set(members.map((member) => member.id)) }
}

function moduleSpecifier(module: string) {
  return `./${module}.js`
}

function docComment(doc: string) {
  if (doc.length === 0) return ''
  return doc.includes('\n') ? `/**\n${doc.replace(/^/gmu, ' * ')}\n */\n` : `/** ${doc} */\n`
}

function header(source: string) {
  return [
    `// Generated from ${source} by scripts/generate-extension-sdk-types.ts;`,
    '// do not edit. Regenerate with `bun run extension-sdk-types:generate`; the',
    '// `extension-sdk-types` check step fails when this file no longer matches the schemas.',
    '',
  ].join('\n')
}

async function renderModule(
  checker: Checker,
  source: SourceModule,
  names: ReadonlyMap<number, NamedType>,
) {
  const printer = createTypePrinter({ checker, module: moduleSpecifier(source.module), names })
  const declarations: string[] = []
  for (const { name, doc, type } of source.types) {
    const owner = names.get(type.id)
    // A second name for a type another public name owns is an alias of that name.
    const body =
      owner !== undefined && owner.name !== name
        ? printer.reference(owner)
        : await printer.printRoot(type)
    declarations.push(`${docComment(doc)}export type ${name} = ${body}\n`)
  }
  const imports = [...printer.referencedNames]
    .filter(([module]) => module !== moduleSpecifier(source.module))
    .toSorted(([left], [right]) => left.localeCompare(right))
    .map(
      ([module, moduleNames]) =>
        `import type { ${[...moduleNames].toSorted().join(', ')} } from '${module}'`,
    )
  return [
    header(`src/internal/type-sources/${source.module}.ts`),
    ...imports,
    '',
    ...declarations,
  ].join('\n')
}

function renderTypeTest(sources: readonly SourceModule[]) {
  const imports = sources.flatMap((source) => {
    const alias = source.module.replaceAll(/-(\w)/gu, (_, letter: string) => letter.toUpperCase())
    return [
      `import type * as ${alias}Generated from '../generated/${source.module}'`,
      `import type * as ${alias}Source from '../internal/type-sources/${source.module}'`,
    ]
  })
  const assertions = sources.flatMap((source) => {
    const alias = source.module.replaceAll(/-(\w)/gu, (_, letter: string) => letter.toUpperCase())
    return source.types.map(
      ({ name }) =>
        `expectTypeOf<${alias}Generated.${name}>().toEqualTypeOf<${alias}Source.${name}>()`,
    )
  })
  return [
    header('src/internal/type-sources'),
    "import { describe, expectTypeOf, it } from 'vitest'",
    ...imports,
    '',
    "describe('the generated public types', () => {",
    '  // Guards the printer: a printed type that drops a readonly, an optional or a member fails here.',
    "  it('equal the schema types they are printed from', () => {",
    ...assertions,
    '  })',
    '})',
    '',
  ].join('\n')
}

function formatWithOxfmt(text: string, root: string, filePath: string) {
  return execFileSync(
    process.execPath,
    [path.join(root, OXFMT_LAUNCHER), `--stdin-filepath=${filePath}`],
    { cwd: root, input: text, encoding: 'utf8', maxBuffer: FORMATTER_OUTPUT_LIMIT_BYTES },
  )
}

async function readSources(checker: Checker, project: Project, root: string) {
  const files = (await fs.readdir(path.join(root, SOURCE_DIRECTORY)))
    .filter((file) => file.endsWith('.ts'))
    .toSorted()
  return Promise.all(
    files.map(async (file) => ({
      module: file.slice(0, -'.ts'.length),
      types: await exportedTypes(checker, project, path.join(root, SOURCE_DIRECTORY, file)),
    })),
  )
}

async function collectNames(
  checker: Checker,
  project: Project,
  root: string,
  sources: readonly SourceModule[],
) {
  const names = new Map<number, NamedType>()
  const add = async (name: string, module: string, type: Type) => {
    if (!names.has(type.id)) names.set(type.id, await namedType(name, module, type))
  }
  for (const named of NAMED_MODULES) {
    for (const { name, type } of await exportedTypes(
      checker,
      project,
      path.join(root, named.file),
    )) {
      await add(name, named.specifier, type)
    }
  }
  for (const source of sources) {
    for (const { name, type } of source.types) {
      await add(name, moduleSpecifier(source.module), type)
    }
  }
  return names
}

/** Every generated file's path and expected contents. */
export async function renderExtensionSdkTypes(root: string) {
  const api = new API({ cwd: root })
  try {
    const config = path.join(root, PROJECT_CONFIG)
    const snapshot = await api.updateSnapshot({ openProjects: [config] })
    const project = snapshot.getProject(config)
    if (project === undefined) throw new Error(`Could not open ${PROJECT_CONFIG}.`)
    const { checker } = project
    const sources = await readSources(checker, project, root)
    const names = await collectNames(checker, project, root, sources)
    const files = new Map<string, string>()
    for (const source of sources) {
      const filePath = `${OUTPUT_DIRECTORY}/${source.module}.ts`
      const text = await renderModule(checker, source, names)
      files.set(filePath, formatWithOxfmt(text, root, filePath))
    }
    files.set(TYPE_TEST_PATH, formatWithOxfmt(renderTypeTest(sources), root, TYPE_TEST_PATH))
    return files
  } finally {
    await api.close()
  }
}

async function staleFiles(root: string, files: ReadonlyMap<string, string>) {
  const stale: string[] = []
  for (const [filePath, expected] of files) {
    const current = await fs.readFile(path.join(root, filePath), 'utf8').catch(() => undefined)
    if (current !== expected) stale.push(filePath)
  }
  const generated = await fs.readdir(path.join(root, OUTPUT_DIRECTORY)).catch(() => [])
  for (const file of generated) {
    const filePath = `${OUTPUT_DIRECTORY}/${file}`
    if (!files.has(filePath)) stale.push(filePath)
  }
  return stale
}

async function main() {
  const root = process.cwd()
  const files = await renderExtensionSdkTypes(root)
  const stale = await staleFiles(root, files)
  if (process.argv.includes('--check')) {
    for (const filePath of stale) {
      console.error(`${filePath} is out of date. Run bun run extension-sdk-types:generate.`)
    }
    if (stale.length === 0) console.log('The generated extension SDK types are current.')
    process.exitCode = stale.length === 0 ? 0 : 1
    return
  }
  await fs.rm(path.join(root, OUTPUT_DIRECTORY), { recursive: true, force: true })
  await fs.mkdir(path.join(root, OUTPUT_DIRECTORY), { recursive: true })
  for (const [filePath, contents] of files) {
    await fs.writeFile(path.join(root, filePath), contents)
    console.log(`Wrote ${filePath}.`)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main()
}
