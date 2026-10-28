import fs from 'node:fs/promises'
import path from 'node:path'
import {
  MAIN_PROCESS_BUDGETS,
  parseMainChunkManifest,
  processStartupChunks,
} from './main-bundle-graph'
import { disallowedTopLevelRequires } from './main-bundle-requires'
import { MAIN_CHUNK_MANIFEST_PATH } from './vite/main-chunk-manifest'

const KIBIBYTE = 1024
const MAIN_OUT_DIRECTORY = path.resolve('out/main')
/**
 * The boot shim runs before V8's compile cache exists, so it is compiled from source on every
 * launch (src/main/boot.ts). It holds the compile cache setup, the `--version`/`--help` router
 * (34 KB when this budget was set) and the desktop app's Session Host prelaunch (W11, 48 KB with
 * it); anything more it imports is paid by every process.
 */
const MAIN_BOOT_FILE = 'boot.js'
const MAX_MAIN_BOOT_BYTES = 56 * KIBIBYTE

async function fileBytes(file: string) {
  return (await fs.stat(path.join(MAIN_OUT_DIRECTORY, file))).size
}

async function topLevelRequireFailures(files: readonly string[]) {
  const failures: string[] = []
  for (const file of files) {
    const source = await fs.readFile(path.join(MAIN_OUT_DIRECTORY, file), 'utf8')
    const disallowed = disallowedTopLevelRequires(source)
    if (disallowed.length > 0) {
      failures.push(
        `out/main/${file} requires ${disallowed.join(', ')} at its top level; import them where they are used, ` +
          'or route them through scripts/vite/lazy-external-requires.ts.',
      )
    }
  }
  return failures
}

async function main() {
  const manifest = parseMainChunkManifest(
    JSON.parse(await fs.readFile(path.join(MAIN_OUT_DIRECTORY, MAIN_CHUNK_MANIFEST_PATH), 'utf8')),
  )
  const failures = await topLevelRequireFailures([
    MAIN_BOOT_FILE,
    ...manifest.map((entry) => entry.file),
  ])
  const bootBytes = await fileBytes(MAIN_BOOT_FILE)
  if (bootBytes > MAX_MAIN_BOOT_BYTES) {
    failures.push(`out/main/${MAIN_BOOT_FILE} is ${String(bootBytes)} bytes; budget is ${String(MAX_MAIN_BOOT_BYTES)} bytes.`)
  }
  const lines = [`${MAIN_BOOT_FILE}: ${String(bootBytes)} bytes`, `${String(manifest.length)} main chunks`]
  for (const budget of MAIN_PROCESS_BUDGETS) {
    const chunks = processStartupChunks(manifest, budget.startupModules)
    const sizes = await Promise.all(chunks.map(fileBytes))
    const bytes = sizes.reduce((total, size) => total + size, 0)
    lines.push(`${budget.label}: ${String(bytes)} bytes in ${String(chunks.length)} chunks at startup`)
    if (bytes > budget.maximumBytes) {
      failures.push(
        `The ${budget.label} loads ${String(bytes)} bytes of main bundle at startup; budget is ${String(budget.maximumBytes)} bytes (scripts/main-bundle-graph.ts).`,
      )
    }
  }
  process.stdout.write(`${lines.join('\n')}\n`)
  if (failures.length > 0) throw new Error(failures.join('\n'))
}

void main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
