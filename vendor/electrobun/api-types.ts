/**
 * Writes the TypeScript declarations of the pinned Electrobun SDK to `vendor/electrobun/types/`.
 *
 * Electrobun 2.x ships its SDK as TypeScript source inside the Hutch devkit (`.hutch/devkit`,
 * written by `bunx electrobun prepare`), not as an npm package. The repository's type check and
 * lint would check that source under OpenWaggle's own strictness flags, so the desktop shell
 * adapters are checked against these declarations instead, and the main build (scripts/build-main.ts)
 * bundles the devkit source itself. Rerun after changing vendor/electrobun/VERSION:
 *
 *   bunx electrobun prepare && bun vendor/electrobun/api-types.ts [--devkit <dir>]
 */
import { spawnSync } from 'node:child_process'
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const REPOSITORY_ROOT = path.resolve(import.meta.dirname, '../..')
const OUTPUT_DIRECTORY = path.join(REPOSITORY_ROOT, 'vendor/electrobun/types')
const ENTRY_FILES = [
  'sdks/main/index.ts',
  'sdks/main/entries/events.ts',
  'browser/index.ts',
  'config/ElectrobunConfig.ts',
]
/**
 * The SDK's default export is an object literal holding a class with private members, which
 * declaration emit cannot name (TS4094). OpenWaggle imports the named exports only.
 */
const DEFAULT_EXPORT_MARKER = '// Default Export'

/**
 * The SDK's open records hold what Electrobun reads from or writes to JSON: `runtime` is copied
 * into build.json and read back through BuildConfig, and the carrot config and manifest are
 * carrot manifest fields. The declarations name them JSON maps instead of `unknown` ones.
 */
const JSON_DECLARATIONS = 'json.d.ts'
const JSON_SOURCE = `/** A value Electrobun reads from or writes to JSON (vendor/electrobun/api-types.ts). */
export type ElectrobunJsonValue = null | boolean | number | string | readonly ElectrobunJsonValue[] | ElectrobunJsonObject;
export interface ElectrobunJsonObject {
    readonly [key: string]: ElectrobunJsonValue;
}
`
/** A map of strings to `unknown` or `any` values, as a record type or an index signature. */
const OPEN_RECORD = /Record<string, (?:unknown|any)>/gu
const OPEN_INDEX_SIGNATURE = /\[key: string\]: (?:unknown|any);/gu

function declarationFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name)
    if (entry.isDirectory()) return declarationFiles(file)
    return entry.name.endsWith('.d.ts') ? [file] : []
  })
}

function withJsonRecords(file: string) {
  const json = path.relative(path.dirname(file), path.join(OUTPUT_DIRECTORY, 'json'))
  const specifier = json.startsWith('.') ? json : `./${json}`
  const source = readFileSync(file, 'utf8')
  const closed = source
    .replace(OPEN_RECORD, `import("${specifier}").ElectrobunJsonObject`)
    .replace(OPEN_INDEX_SIGNATURE, `[key: string]: import("${specifier}").ElectrobunJsonValue;`)
  if (closed !== source) writeFileSync(file, closed)
}

function devkitDirectory(argv: readonly string[]) {
  const flag = argv.indexOf('--devkit')
  const given = flag === -1 ? undefined : argv[flag + 1]
  return path.resolve(given ?? path.join(REPOSITORY_ROOT, '.hutch/devkit'))
}

function withoutDefaultExport(source: string) {
  const marker = source.indexOf(DEFAULT_EXPORT_MARKER)
  if (marker === -1) throw new Error(`The SDK index no longer has "${DEFAULT_EXPORT_MARKER}".`)
  return `${source.slice(0, marker)}\n`
}

function main() {
  const devkit = devkitDirectory(process.argv.slice(2))
  const manifest: unknown = JSON.parse(readFileSync(path.join(devkit, 'package.json'), 'utf8'))
  const version =
    typeof manifest === 'object' && manifest !== null ? Reflect.get(manifest, 'version') : null
  const pinned = readFileSync(path.join(REPOSITORY_ROOT, 'vendor/electrobun/VERSION'), 'utf8')
  if (typeof version !== 'string' || !pinned.startsWith(`${version}-`)) {
    throw new Error(`The devkit is Electrobun ${String(version)}; VERSION pins ${pinned.trim()}.`)
  }
  const work = mkdtempSync(path.join(tmpdir(), 'electrobun-api-'))
  try {
    cpSync(path.join(devkit, 'api'), path.join(work, 'api'), { recursive: true })
    const index = path.join(work, 'api/sdks/main/index.ts')
    writeFileSync(index, withoutDefaultExport(readFileSync(index, 'utf8')))
    const config = {
      compilerOptions: {
        declaration: true,
        emitDeclarationOnly: true,
        noCheck: true,
        skipLibCheck: true,
        module: 'esnext',
        target: 'esnext',
        moduleResolution: 'bundler',
        allowImportingTsExtensions: true,
        jsx: 'react-jsx',
        types: [],
        rootDir: path.join(work, 'api'),
        outDir: OUTPUT_DIRECTORY,
      },
      files: ENTRY_FILES.map((file) => path.join(work, 'api', file)),
    }
    writeFileSync(path.join(work, 'tsconfig.json'), JSON.stringify(config))
    rmSync(OUTPUT_DIRECTORY, { recursive: true, force: true })
    const tsc = path.join(REPOSITORY_ROOT, 'node_modules/.bin/tsc')
    const result = spawnSync(tsc, ['-p', path.join(work, 'tsconfig.json')], { stdio: 'inherit' })
    if (result.status !== 0) throw new Error(`tsc exited with ${String(result.status)}`)
    for (const file of declarationFiles(OUTPUT_DIRECTORY)) withJsonRecords(file)
    writeFileSync(path.join(OUTPUT_DIRECTORY, JSON_DECLARATIONS), JSON_SOURCE)
    writeFileSync(
      path.join(OUTPUT_DIRECTORY, 'VERSION'),
      `${version}\nGenerated by vendor/electrobun/api-types.ts; do not edit.\n`,
    )
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}

main()
